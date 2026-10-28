mod recovery;
mod video;

use super::{
    PipelineReport, Renewal, Signals, WorkerPhase,
    control::{Control, Pacer},
};
use ss_audio_windows::SystemLoopback;
use ss_domain::{QualityMode, QualityReason, VideoProfile};
use ss_media_proof::protocol::{AudioMode, QualityMode as RequestedQuality};
use ss_media_windows::{
    CaptureError, CaptureReader, CaptureStatus, EncoderPoll, HardwareEncoder, NativeFrame,
    SubmitOutcome,
};
use ss_rtc_livekit::native_proof::{NativePublisher, NativeTransportError};
use std::{
    sync::{
        atomic::Ordering,
        mpsc::{Receiver, TryRecvError},
    },
    time::{Duration, Instant},
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
    diagnostics_generation: u64,
    diagnostics_started: Instant,
    capture_generation: Option<u64>,
    capture_recovering: bool,
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
            diagnostics_generation: 1,
            diagnostics_started: Instant::now(),
            capture_generation: None,
            capture_recovering: false,
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

    pub fn feedback(
        &mut self,
        publisher: &mut NativePublisher,
        signals: &Signals,
    ) -> Result<(), &'static str> {
        let feedback = publisher
            .feedback()
            .map_err(|_| "Publication authorization or transport became unavailable")?;
        self.control.feedback(feedback, &mut self.report)?;
        if let Some(encoder) = self.encoder.as_mut()
            && let Err(error) = self.control.apply(encoder, &mut self.report)
            && !encoder.device_lost()
        {
            super::failure::encoder(
                signals,
                ss_media_proof::protocol::FailureStage::EncoderControl,
                error,
            );
            return Err("Hardware encoder feedback failed");
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
            let timings = self
                .encoder
                .as_ref()
                .map(|encoder| encoder.diagnostics())
                .unwrap_or_default();
            snapshot.diagnostics_generation = self.diagnostics_generation;
            snapshot.diagnostics_elapsed_ms = self
                .diagnostics_started
                .elapsed()
                .as_millis()
                .min(u128::from(u64::MAX)) as u64;
            snapshot.conversion_submission_ms = timings.conversion_submission_ms;
            snapshot.encoder_output_latency_ms = timings.encoder_output_latency_ms;
            snapshot.available_send_bitrate_bps = if phase == WorkerPhase::Sharing {
                self.control.available_send_bitrate()
            } else {
                None
            };
            snapshot.manual_bitrate_bps = Some(self.control.bitrate_cap());
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
        self.diagnostics_generation = self
            .diagnostics_generation
            .checked_add(1)
            .ok_or("Diagnostic generation overflowed")?;
        self.diagnostics_started = Instant::now();
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
            .set_paused(self.paused || self.capture_recovering)
            .map_err(|_| "Publication state after renewal failed")?;
        if let Some(audio) = self.audio.as_mut() {
            audio
                .set_paused(self.paused || self.capture_recovering)
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
        while !signals.stop.load(Ordering::Acquire) {
            self.feedback(publisher, signals)?;
            let generation = reader.generation();
            if self
                .encoder
                .as_ref()
                .is_some_and(|encoder| encoder.device_lost())
            {
                let _ = reader.report_device_loss(self.capture_generation.unwrap_or(generation));
            }
            if self.capture_generation != Some(generation) {
                self.stop_encoder()?;
                self.capture_generation = Some(generation);
                self.control.suspend();
                publisher
                    .require_keyframe()
                    .map_err(|_| "Recovery keyframe gate failed")?;
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
                        .set_paused(paused || self.capture_recovering)
                        .map_err(|_| "Audio pause or resume failed")?;
                }
                if !paused && !self.capture_recovering {
                    publisher
                        .set_paused(false)
                        .map_err(|_| "Publication resume failed")?;
                }
            }
            if matches!(
                reader.status().map_err(|_| "Capture status unavailable")?,
                CaptureStatus::Failed(CaptureError::DeviceLost)
            ) {
                self.pause_for_recovery(publisher)?;
                // The STA retains the exact selected item while rebuilding only
                // its invalidated hardware resources. Keep checking the lease.
                self.publish_snapshot(
                    signals,
                    if self.paused {
                        WorkerPhase::Paused
                    } else {
                        WorkerPhase::Sharing
                    },
                );
                tokio::time::sleep(Duration::from_millis(5)).await;
                continue;
            }
            self.adapt_profile(publisher)?;
            if reader.generation() != generation {
                continue;
            }
            if !capture_active(&reader, generation)? {
                if matches!(
                    reader.status().map_err(|_| "Capture status unavailable")?,
                    CaptureStatus::Failed(CaptureError::DeviceLost)
                ) {
                    continue;
                }
                break;
            }
            self.resume_after_recovery(publisher)?;
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
                self.feedback(publisher, signals)?;
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
                if frame.generation() != generation {
                    continue;
                }
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
                match HardwareEncoder::new(frame, self.profile, self.control.bitrate()) {
                    Ok(encoder) => self.encoder = Some(encoder),
                    Err(_) if HardwareEncoder::device_lost_for(frame) => {
                        let _ = reader.report_device_loss(generation);
                        self.pause_for_recovery(publisher)?;
                        continue;
                    }
                    Err(error) => {
                        super::failure::encoder(
                            signals,
                            ss_media_proof::protocol::FailureStage::EncoderInitialization,
                            error,
                        );
                        return Err("Hardware encoder initialization failed");
                    }
                }
                self.control.initialized();
            }
            self.encode_pending(publisher, &reader, generation, signals)
                .await?;
            tokio::time::sleep(Duration::from_millis(3)).await;
        }
        Ok(())
    }
}

fn capture_active(reader: &CaptureReader, expected_generation: u64) -> Result<bool, &'static str> {
    match reader.status().map_err(|_| "Capture status unavailable")? {
        CaptureStatus::Capturing => Ok(reader.generation() == expected_generation),
        CaptureStatus::Failed(CaptureError::DeviceLost) => Ok(false),
        CaptureStatus::SourceClosed | CaptureStatus::Stopped => Ok(false),
        CaptureStatus::Failed(_) => Err("Native capture failed; no fallback source was selected"),
    }
}
