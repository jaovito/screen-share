use super::{
    PipelineReport, Renewal, Signals, WorkerPhase,
    control::{Control, Pacer},
};
use ss_audio_windows::SystemLoopback;
use ss_domain::{QualityMode, QualityReason, VideoProfile};
use ss_media_proof::protocol::{AudioMode, QualityMode as RequestedQuality};
use ss_media_windows::{
    CaptureReader, CaptureStatus, EncoderPoll, HardwareEncoder, NativeFrame, SubmitOutcome,
};
use ss_rtc_livekit::native_proof::{NativePublisher, NativeTransportError};
use std::{
    sync::{
        atomic::Ordering,
        mpsc::{Receiver, TryRecvError},
    },
    time::Duration,
};

pub(super) struct Pipeline {
    encoder: Option<HardwareEncoder>,
    pending: Option<NativeFrame>,
    control: Control,
    profile: VideoProfile,
    pub report: PipelineReport,
    pacing: Pacer,
    paused: bool,
    publication_origin: Option<i64>,
    encoder_offset_us: i64,
    audio_mode: AudioMode,
    audio_process: Option<(u32, u64)>,
    audio: Option<SystemLoopback>,
    quality_mode: QualityMode,
    adaptation_reason: Option<QualityReason>,
}

impl Pipeline {
    pub fn new(
        profile: VideoProfile,
        bitrate: u32,
        audio: AudioMode,
        audio_process: Option<(u32, u64)>,
        quality: RequestedQuality,
    ) -> Result<Self, &'static str> {
        let quality_mode = match quality {
            RequestedQuality::Motion => QualityMode::Motion,
            RequestedQuality::Text => QualityMode::Text,
        };
        Ok(Self {
            encoder: None,
            pending: None,
            control: Control::new(bitrate, profile, quality_mode)?,
            profile,
            report: PipelineReport::default(),
            pacing: Pacer::new(),
            paused: false,
            publication_origin: None,
            encoder_offset_us: 0,
            audio_mode: audio,
            audio_process,
            audio: None,
            quality_mode,
            adaptation_reason: None,
        })
    }

    pub async fn start_audio(
        &mut self,
        publisher: &mut NativePublisher,
    ) -> Result<(), &'static str> {
        let capture = match self.audio_mode {
            AudioMode::Off => None,
            AudioMode::System => {
                Some(SystemLoopback::start().map_err(|_| "Requested system audio is unavailable")?)
            }
            AudioMode::Process => {
                let (pid, created) = self
                    .audio_process
                    .ok_or("An explicit audio process selection is required")?;
                Some(
                    SystemLoopback::start_process_verified(pid, created)
                        .map_err(|_| "Selected application audio is unavailable")?,
                )
            }
        };
        if let Some(capture) = capture {
            self.audio = Some(capture);
            publisher
                .enable_audio()
                .await
                .map_err(|_| "Encrypted audio publication was not authorized")?;
        }
        Ok(())
    }

    pub fn stop_media(&mut self) -> Result<(), &'static str> {
        let video = self.stop_encoder();
        let audio = self.audio.as_mut().map_or(Ok(()), |audio| {
            audio.stop().map_err(|_| "System audio cleanup failed")
        });
        self.audio = None;
        video?;
        audio
    }

    pub fn feedback(&mut self, publisher: &mut NativePublisher) -> Result<(), &'static str> {
        let feedback = publisher
            .feedback()
            .map_err(|_| "Publication authorization or transport became unavailable")?;
        self.control.feedback(feedback, &mut self.report)?;
        if let Some(encoder) = self.encoder.as_mut() {
            self.control.apply(encoder, &mut self.report)?;
        }
        Ok(())
    }

    pub fn publish_snapshot(&self, signals: &Signals, phase: WorkerPhase) {
        if let Ok(mut snapshot) = signals.snapshot.lock() {
            snapshot.phase = phase;
            snapshot.profile = self.profile;
            snapshot.target_fps = self.control.target_fps();
            snapshot.target_bitrate_bps = Some(self.control.bitrate());
            snapshot.adaptation_reason = self.adaptation_reason;
            snapshot.report = self.report.clone();
        }
    }

    pub fn stop_encoder(&mut self) -> Result<(), &'static str> {
        self.pending = None;
        if let Some(encoder) = self.encoder.as_mut() {
            encoder
                .stop()
                .map_err(|_| "Hardware encoder cleanup failed")?;
        }
        self.encoder = None;
        self.pacing = Pacer::new();
        self.control.recover(true);
        Ok(())
    }

    fn adapt_profile(&mut self, publisher: &mut NativePublisher) -> Result<(), &'static str> {
        let profile = self.control.profile();
        if profile != self.profile {
            // Drop the previous encoder and pending texture before changing
            // output dimensions. CaptureReader retains the original WGC item.
            self.stop_encoder()?;
            publisher
                .reconfigure_profile(profile)
                .map_err(|_| "Adaptive publication profile was rejected")?;
            self.profile = profile;
            self.adaptation_reason = self.control.quality_reason();
            self.report.quality_changes = self.report.quality_changes.saturating_add(1);
            self.report.rate_updates = self.report.rate_updates.saturating_add(1);
        }
        Ok(())
    }

    async fn renew(
        &mut self,
        publisher: &mut NativePublisher,
        renewal: Renewal,
        signals: &Signals,
    ) -> Result<(), &'static str> {
        self.publish_snapshot(signals, WorkerPhase::Connecting);
        publisher
            .set_paused(true)
            .map_err(|_| "Publication pause before renewal failed")?;
        self.stop_encoder()?;
        if let Some(audio) = self.audio.as_mut() {
            audio
                .set_paused(true)
                .map_err(|_| "Audio pause before renewal failed")?;
        }
        match renewal.profile {
            Some((profile, bitrate)) => {
                publisher
                    .renew_with_profile(renewal.grant, profile, bitrate)
                    .await
                    .map_err(|_| "Fresh publication grant or profile was rejected")?;
                self.profile = profile;
                self.control = Control::new(bitrate, profile, self.quality_mode)?;
                self.adaptation_reason = None;
            }
            None => publisher
                .renew(renewal.grant)
                .await
                .map_err(|_| "Fresh publication grant was rejected")?,
        }
        publisher
            .set_paused(self.paused)
            .map_err(|_| "Publication state after renewal failed")?;
        if let Some(audio) = self.audio.as_mut() {
            audio
                .set_paused(self.paused)
                .map_err(|_| "Audio state after renewal failed")?;
        }
        self.publish_snapshot(
            signals,
            if self.paused {
                WorkerPhase::Paused
            } else {
                WorkerPhase::Sharing
            },
        );
        Ok(())
    }

    pub async fn drive(
        &mut self,
        publisher: &mut NativePublisher,
        reader: CaptureReader,
        renewals: &Receiver<Renewal>,
        signals: &Signals,
    ) -> Result<(), &'static str> {
        'media: while !signals.stop.load(Ordering::Acquire) {
            self.feedback(publisher)?;
            self.adapt_profile(publisher)?;
            if !capture_active(&reader)? {
                break;
            }
            match renewals.try_recv() {
                Ok(renewal) => {
                    self.renew(publisher, renewal, signals).await?;
                    continue;
                }
                Err(TryRecvError::Disconnected) => return Err("Capture owner disconnected"),
                Err(TryRecvError::Empty) => {}
            }
            let paused = signals.paused.load(Ordering::Acquire);
            if paused != self.paused {
                publisher
                    .set_paused(true)
                    .map_err(|_| "Publication pause failed")?;
                self.stop_encoder()?;
                self.control.suspend();
                self.paused = paused;
                if let Some(audio) = self.audio.as_mut() {
                    audio
                        .set_paused(paused)
                        .map_err(|_| "Audio pause or resume failed")?;
                }
                if !paused {
                    publisher
                        .set_paused(false)
                        .map_err(|_| "Publication resume failed")?;
                }
            }
            self.publish_snapshot(
                signals,
                if self.paused {
                    WorkerPhase::Paused
                } else {
                    WorkerPhase::Sharing
                },
            );
            if self.paused {
                self.control.suspend();
                // The STA also suspends texture production. Drain any pre-pause
                // ownership without publishing it or replacing the selected source.
                drop(
                    reader
                        .take_frame()
                        .map_err(|_| "Paused capture cleanup failed")?,
                );
                tokio::time::sleep(Duration::from_millis(5)).await;
                continue;
            }
            if let Some(audio) = self.audio.as_mut()
                && let Some(packet) = audio
                    .read()
                    .map_err(|_| "System audio device became unavailable")?
            {
                // One bounded native PCM packet; no audio crosses IPC or JSON.
                self.feedback(publisher)?;
                publisher
                    .push_audio(&packet.samples)
                    .await
                    .map_err(|_| "Encrypted audio publication failed")?;
                self.report.audio_samples = self
                    .report
                    .audio_samples
                    .saturating_add(packet.samples.len() as u64);
            }
            if let Some(frame) = reader
                .take_frame()
                .map_err(|_| "Native capture frame unavailable")?
            {
                self.report.frames_consumed = self.report.frames_consumed.saturating_add(1);
                self.pending = Some(frame);
            }
            if self.encoder.is_none()
                && let Some(frame) = self.pending.as_ref()
            {
                let origin = *self
                    .publication_origin
                    .get_or_insert(frame.timestamp_100ns());
                self.encoder_offset_us = frame
                    .timestamp_100ns()
                    .checked_sub(origin)
                    .ok_or("Capture clock changed")?
                    / 10;
                self.encoder = Some(HardwareEncoder::new(frame, self.profile, self.control.bitrate()).map_err(|_| "Hardware encoder initialization failed or capabilities are unsupported")?);
                self.control.initialized();
            }
            tokio::task::yield_now().await;
            if signals.stop.load(Ordering::Acquire)
                || signals.paused.load(Ordering::Acquire)
                || !capture_active(&reader)?
            {
                continue;
            }
            self.feedback(publisher)?;
            for _ in 0..8 {
                if signals.stop.load(Ordering::Acquire)
                    || signals.paused.load(Ordering::Acquire)
                    || !capture_active(&reader)?
                {
                    continue 'media;
                }
                self.feedback(publisher)?;
                let Some(encoder) = self.encoder.as_mut() else {
                    break;
                };
                let event = encoder
                    .poll()
                    .map_err(|_| "Asynchronous hardware encoding failed")?;
                tokio::task::yield_now().await;
                self.feedback(publisher)?;
                match event {
                    EncoderPoll::Pending => break,
                    EncoderPoll::NeedInput => {}
                    EncoderPoll::Output(unit) => {
                        let unit = unit
                            .offset_timestamp_us(self.encoder_offset_us)
                            .map_err(|_| "Publication clock overflowed")?;
                        self.report.access_units = self.report.access_units.saturating_add(1);
                        tokio::task::yield_now().await;
                        self.feedback(publisher)?;
                        if signals.stop.load(Ordering::Acquire)
                            || signals.paused.load(Ordering::Acquire)
                            || !capture_active(&reader)?
                        {
                            continue 'media;
                        }
                        match publisher.push(&unit) {
                            Ok(feedback) => {
                                self.report.bytes_sent = self
                                    .report
                                    .bytes_sent
                                    .saturating_add(unit.payload().len() as u64);
                                self.control.accepted(unit.is_keyframe());
                                self.control.feedback(feedback, &mut self.report)?;
                            }
                            Err(NativeTransportError::KeyframeRequired) => {
                                self.control.recover(false)
                            }
                            Err(NativeTransportError::FrameRejected) => self.control.recover(true),
                            Err(_) => {
                                return Err(
                                    "Encoded publication failed or its lease became invalid",
                                );
                            }
                        }
                    }
                }
            }
            self.feedback(publisher)?;
            if signals.stop.load(Ordering::Acquire)
                || signals.paused.load(Ordering::Acquire)
                || !capture_active(&reader)?
            {
                continue;
            }
            if let Some(encoder) = self.encoder.as_mut()
                && let Some(frame) = self.pending.as_ref()
                && self
                    .pacing
                    .due(frame.timestamp_100ns(), self.control.interval_100ns())?
            {
                match encoder
                    .submit(frame)
                    .map_err(|_| "GPU conversion or hardware encoder input failed")?
                {
                    SubmitOutcome::Accepted => {
                        self.pacing.accepted(frame.timestamp_100ns())?;
                        self.report.samples_submitted =
                            self.report.samples_submitted.saturating_add(1);
                        self.pending = None;
                    }
                    SubmitOutcome::Backpressure => {}
                }
            }
            tokio::time::sleep(Duration::from_millis(3)).await;
        }
        Ok(())
    }
}

fn capture_active(reader: &CaptureReader) -> Result<bool, &'static str> {
    match reader.status().map_err(|_| "Capture status unavailable")? {
        CaptureStatus::Capturing => Ok(true),
        CaptureStatus::SourceClosed | CaptureStatus::Stopped => Ok(false),
        CaptureStatus::Failed(_) => Err("Native capture failed; no fallback source was selected"),
    }
}
