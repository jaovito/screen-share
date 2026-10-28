use super::{Input, PipelineReport, PublicationSetup, Signals, WorkerPhase, drive::Pipeline};
use ss_rtc_livekit::native_proof::NativePublisher;
use std::{
    sync::{
        atomic::Ordering,
        mpsc::{SyncSender, TryRecvError},
    },
    time::{Duration, Instant},
};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};

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

pub(super) fn execute(
    setup: PublicationSetup,
    input: Input,
    signals: &Signals,
    ready: &SyncSender<Result<(), &'static str>>,
    ready_sent: &mut bool,
) -> Result<PipelineReport, &'static str> {
    let _mta = Mta::open()?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "Media worker runtime failed")?;
    runtime.block_on(run(setup, input, signals, ready, ready_sent))
}

async fn run(
    setup: PublicationSetup,
    input: Input,
    signals: &Signals,
    ready: &SyncSender<Result<(), &'static str>>,
    ready_sent: &mut bool,
) -> Result<PipelineReport, &'static str> {
    let heartbeat_snapshot = signals.snapshot.clone();
    let heartbeat_stop = signals.stop.clone();
    let _heartbeat = tokio::spawn(async move {
        while !heartbeat_stop.load(Ordering::Acquire) {
            if let Ok(mut snapshot) = heartbeat_snapshot.lock() {
                snapshot.heartbeat = Instant::now();
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    });
    let mut pipeline = Pipeline::new(
        setup.profile,
        setup.bitrate,
        setup.audio,
        setup.audio_process,
        setup.quality,
    )?;
    let mut publisher =
        NativePublisher::connect(setup.grant, setup.key, setup.profile, setup.bitrate)
            .await
            .map_err(|_| "Scoped encrypted publication setup failed")?;
    let work = async {
        if signals.stop.load(Ordering::Acquire) {
            return Err("Publication stopped before capture");
        }
        pipeline.feedback(&mut publisher, signals)?;
        pipeline.start_audio(&mut publisher).await?;
        pipeline.feedback(&mut publisher, signals)?;
        ready
            .send(Ok(()))
            .map_err(|_| "Capture owner closed before publication was ready")?;
        *ready_sent = true;
        let waiting = Instant::now();
        let reader = loop {
            if signals.stop.load(Ordering::Acquire) {
                return Err("Publication stopped before capture");
            }
            pipeline.feedback(&mut publisher, signals)?;
            match input.frames.try_recv() {
                Ok(reader) => break reader,
                Err(TryRecvError::Disconnected) => return Err("Capture owner disconnected"),
                Err(TryRecvError::Empty) => {}
            }
            if waiting.elapsed() >= Duration::from_secs(5) {
                return Err("Authorized capture startup timed out");
            }
            tokio::time::sleep(Duration::from_millis(3)).await;
        };
        pipeline
            .drive(&mut publisher, reader, &input.renew, signals)
            .await
    }
    .await;
    if let Err(message) = work.as_ref()
        && let Ok(mut snapshot) = signals.snapshot.lock()
    {
        snapshot
            .failure
            .get_or_insert_with(|| ss_media_proof::protocol::NativeFailure::worker(message));
    }
    signals.stop.store(true, Ordering::Release);
    pipeline.publish_snapshot(
        signals,
        if work.is_ok() {
            WorkerPhase::Stopped
        } else {
            WorkerPhase::Failed
        },
    );
    let encoder_stopped = pipeline.stop_media();
    let transport_closed = publisher
        .close()
        .await
        .map_err(|_| "Encrypted publication cleanup failed");
    ss_media_proof::protocol::finish_publication(work, &[encoder_stopped, transport_closed])?;
    Ok(pipeline.report)
}
