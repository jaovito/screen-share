mod control;

use control::{Control, Pacer};
use ss_domain::VideoProfile;
use ss_media_windows::{
    CaptureReader, CaptureStatus, EncoderPoll, HardwareEncoder, NativeFrame, SubmitOutcome,
};
use ss_rtc_livekit::native_proof::{
    MediaKey, NativePublisher, NativeTransportError, PublisherGrant,
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};

#[derive(Default)]
pub struct PipelineReport {
    pub frames_consumed: u64,
    pub samples_submitted: u64,
    pub access_units: u64,
    /// Encoded payload bytes accepted by the SDK, not measured wire traffic.
    pub bytes_sent: u64,
    pub rate_updates: u64,
    pub keyframe_requests: u64,
}

pub struct Worker {
    pub ready: Receiver<Result<(), &'static str>>,
    pub result: Receiver<Result<PipelineReport, &'static str>>,
    pub frames: SyncSender<CaptureReader>,
    pub stop: Arc<AtomicBool>,
    pub handle: Option<JoinHandle<()>>,
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

struct PublicationSetup {
    grant: PublisherGrant,
    key: MediaKey,
    profile: VideoProfile,
    bitrate: u32,
}

struct Mta;
impl Mta {
    fn open() -> Result<Self, &'static str> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|_| "Media worker MTA initialization failed")?;
        Ok(Self)
    }
}
impl Drop for Mta {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub fn spawn(
    grant: PublisherGrant,
    key: MediaKey,
    profile: VideoProfile,
    bitrate: u32,
) -> Result<Worker, &'static str> {
    let (ready_tx, ready) = mpsc::sync_channel(1);
    let (result_tx, result) = mpsc::sync_channel(1);
    let (frames, frames_rx) = mpsc::sync_channel(1);
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();
    let handle = thread::Builder::new()
        .name("m1-native-publisher".into())
        .spawn(move || {
            let mut ready_sent = false;
            let outcome = (|| {
                let _mta = Mta::open()?;
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|_| "Media worker runtime failed")?;
                runtime.block_on(run(
                    PublicationSetup {
                        grant,
                        key,
                        profile,
                        bitrate,
                    },
                    &frames_rx,
                    &worker_stop,
                    &ready_tx,
                    &mut ready_sent,
                ))
            })();
            worker_stop.store(true, Ordering::Release);
            if !ready_sent {
                let failure = outcome
                    .as_ref()
                    .err()
                    .copied()
                    .unwrap_or("Publication stopped before capture was authorized");
                let _ = ready_tx.send(Err(failure));
            }
            let _ = result_tx.send(outcome);
        })
        .map_err(|_| "Media worker could not start")?;

    Ok(Worker {
        ready,
        result,
        frames,
        stop,
        handle: Some(handle),
    })
}

struct Pipeline {
    encoder: Option<HardwareEncoder>,
    pending: Option<NativeFrame>,
    control: Control,
    profile: VideoProfile,
    report: PipelineReport,
    pacing: Pacer,
}

impl Pipeline {
    fn feedback(&mut self, publisher: &mut NativePublisher) -> Result<(), &'static str> {
        // This is also the current lease, acknowledged permission and E2EE gate.
        let feedback = publisher
            .feedback()
            .map_err(|_| "Publication authorization or transport became unavailable")?;
        self.control.feedback(feedback, &mut self.report)?;
        if let Some(encoder) = self.encoder.as_mut() {
            self.control.apply(encoder, &mut self.report)?;
        }
        Ok(())
    }

    async fn drive(
        &mut self,
        publisher: &mut NativePublisher,
        reader: CaptureReader,
        stop: &AtomicBool,
    ) -> Result<(), &'static str> {
        'media: while !stop.load(Ordering::Acquire) {
            self.feedback(publisher)?;
            if !capture_active(&reader)? {
                break;
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
                let encoder = HardwareEncoder::new(frame, self.profile, self.control.bitrate()).map_err(|_| "Hardware encoder initialization failed or capabilities are unsupported")?;
                self.encoder = Some(encoder);
                self.control.initialized();
            }
            // Native initialization/encoding may block. Let the current-thread
            // runtime process queued SDK/supervisor events before the fresh gate.
            tokio::task::yield_now().await;
            if stop.load(Ordering::Acquire) || !capture_active(&reader)? {
                break;
            }
            self.feedback(publisher)?;
            for _ in 0..8 {
                if stop.load(Ordering::Acquire) || !capture_active(&reader)? {
                    break 'media;
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
                        self.report.access_units = self.report.access_units.saturating_add(1);
                        self.feedback(publisher)?;
                        tokio::task::yield_now().await;
                        let current = publisher.feedback().map_err(
                            |_| "Publication authorization or transport became unavailable",
                        )?;
                        self.control.feedback(current, &mut self.report)?;
                        if stop.load(Ordering::Acquire) || !capture_active(&reader)? {
                            break 'media;
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
            if stop.load(Ordering::Acquire) || !capture_active(&reader)? {
                break;
            }
            self.feedback(publisher)?;
            if let Some(encoder) = self.encoder.as_mut()
                && let Some(frame) = self.pending.as_ref()
            {
                let due = self
                    .pacing
                    .due(frame.timestamp_100ns(), self.control.interval_100ns())?;
                if due {
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
            }
            tokio::time::sleep(Duration::from_millis(3)).await;
        }
        Ok(())
    }
}

async fn run(
    setup: PublicationSetup,
    frames: &Receiver<CaptureReader>,
    stop: &AtomicBool,
    ready: &SyncSender<Result<(), &'static str>>,
    ready_sent: &mut bool,
) -> Result<PipelineReport, &'static str> {
    let PublicationSetup {
        grant,
        key,
        profile,
        bitrate,
    } = setup;
    let mut pipeline = Pipeline {
        encoder: None,
        pending: None,
        control: Control::new(bitrate, profile.fps)?,
        profile,
        report: PipelineReport::default(),
        pacing: Pacer::new(),
    };
    let mut publisher = NativePublisher::connect(grant, key, profile, bitrate)
        .await
        .map_err(|_| "Scoped encrypted publication setup failed")?;
    let work = async {
        if stop.load(Ordering::Acquire) {
            return Err("Publication stopped before capture");
        }
        pipeline.feedback(&mut publisher)?;
        ready
            .send(Ok(()))
            .map_err(|_| "Capture owner closed before publication was ready")?;
        *ready_sent = true;
        let waiting = Instant::now();
        let reader = loop {
            if stop.load(Ordering::Acquire) {
                return Err("Publication stopped before capture");
            }
            pipeline.feedback(&mut publisher)?;
            match frames.try_recv() {
                Ok(reader) => break reader,
                Err(TryRecvError::Disconnected) => return Err("Capture owner disconnected"),
                Err(TryRecvError::Empty) => {}
            }
            if waiting.elapsed() >= Duration::from_secs(5) {
                return Err(
                    "Authorized capture did not become available before its startup deadline",
                );
            }
            tokio::time::sleep(Duration::from_millis(3)).await;
        };
        pipeline.drive(&mut publisher, reader, stop).await
    }
    .await;
    // Signal the STA before potentially blocking hardware cleanup. It owns and
    // stops WGC independently and keeps its explicit own-process watchdog active.
    stop.store(true, Ordering::Release);
    pipeline.pending = None;
    let encoder_stopped = if let Some(encoder) = pipeline.encoder.as_mut() {
        encoder
            .stop()
            .map_err(|_| "Hardware encoder cleanup failed")
    } else {
        Ok(())
    };
    let transport_closed = publisher
        .close()
        .await
        .map_err(|_| "Encrypted publication cleanup failed");
    encoder_stopped?;
    transport_closed?;
    work?;

    Ok(pipeline.report)
}

fn capture_active(reader: &CaptureReader) -> Result<bool, &'static str> {
    match reader.status().map_err(|_| "Capture status unavailable")? {
        CaptureStatus::Capturing => Ok(true),
        CaptureStatus::SourceClosed | CaptureStatus::Stopped => Ok(false),
        CaptureStatus::Failed(_) => Err("Native capture failed; no fallback source was selected"),
    }
}
