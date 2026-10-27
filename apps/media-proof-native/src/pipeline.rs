mod control;
mod drive;
mod runtime;

use ss_domain::{QualityReason, VideoProfile};
use ss_media_proof::protocol::{AudioMode, QualityMode};
use ss_media_windows::CaptureReader;
use ss_rtc_livekit::native_proof::{MediaKey, PublisherGrant};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    thread::{self, JoinHandle},
    time::Instant,
};

#[derive(Clone, Default)]
pub struct PipelineReport {
    pub frames_consumed: u64,
    pub samples_submitted: u64,
    pub access_units: u64,
    /// Encoded payload bytes accepted by the SDK, not measured wire traffic.
    pub bytes_sent: u64,
    pub rate_updates: u64,
    pub keyframe_requests: u64,
    pub audio_samples: u64,
    pub quality_changes: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WorkerPhase {
    Connecting,
    Sharing,
    Paused,
    Stopped,
    Failed,
}

#[derive(Clone)]
pub struct Snapshot {
    pub phase: WorkerPhase,
    pub report: PipelineReport,
    pub profile: VideoProfile,
    pub target_fps: f64,
    pub heartbeat: Instant,
    pub adaptation_reason: Option<QualityReason>,
    pub target_bitrate_bps: Option<u32>,
    pub diagnostics_generation: u64,
    pub diagnostics_elapsed_ms: u64,
    pub conversion_submission_ms: Option<f64>,
    pub encoder_output_latency_ms: Option<f64>,
    pub available_send_bitrate_bps: Option<u64>,
    pub manual_bitrate_bps: Option<u32>,
}

pub struct Renewal {
    pub grant: PublisherGrant,
    pub profile: Option<(VideoProfile, u32)>,
}

pub struct Worker {
    pub ready: Receiver<Result<(), &'static str>>,
    pub result: Receiver<Result<PipelineReport, &'static str>>,
    pub frames: SyncSender<CaptureReader>,
    pub stop: Arc<AtomicBool>,
    pub paused: Arc<AtomicBool>,
    pub renew: SyncSender<Renewal>,
    pub snapshot: Arc<Mutex<Snapshot>>,
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
    audio: AudioMode,
    audio_process: Option<(u32, u64)>,
    quality: QualityMode,
}

struct Signals {
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    snapshot: Arc<Mutex<Snapshot>>,
}

struct Input {
    frames: Receiver<CaptureReader>,
    renew: Receiver<Renewal>,
}

pub fn spawn(
    grant: PublisherGrant,
    key: MediaKey,
    profile: VideoProfile,
    bitrate: u32,
) -> Result<Worker, &'static str> {
    spawn_with_audio(
        grant,
        key,
        profile,
        bitrate,
        AudioMode::Off,
        None,
        QualityMode::Motion,
    )
}

pub fn spawn_with_audio(
    grant: PublisherGrant,
    key: MediaKey,
    profile: VideoProfile,
    bitrate: u32,
    audio: AudioMode,
    audio_process: Option<(u32, u64)>,
    quality: QualityMode,
) -> Result<Worker, &'static str> {
    let (ready_tx, ready) = mpsc::sync_channel(1);
    let (result_tx, result) = mpsc::sync_channel(1);
    let (frames, frames_rx) = mpsc::sync_channel(1);
    let (renew, renew_rx) = mpsc::sync_channel(1);
    let stop = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let snapshot = Arc::new(Mutex::new(Snapshot {
        phase: WorkerPhase::Connecting,
        report: PipelineReport::default(),
        profile,
        target_fps: f64::from(profile.fps),
        heartbeat: Instant::now(),
        adaptation_reason: None,
        target_bitrate_bps: None,
        diagnostics_generation: 0,
        diagnostics_elapsed_ms: 0,
        conversion_submission_ms: None,
        encoder_output_latency_ms: None,
        available_send_bitrate_bps: None,
        manual_bitrate_bps: None,
    }));
    let signals = Signals {
        stop: stop.clone(),
        paused: paused.clone(),
        snapshot: snapshot.clone(),
    };
    let handle = thread::Builder::new()
        .name("native-publisher".into())
        .spawn(move || {
            let mut ready_sent = false;
            let outcome = runtime::execute(
                PublicationSetup {
                    grant,
                    key,
                    profile,
                    bitrate,
                    audio,
                    audio_process,
                    quality,
                },
                Input {
                    frames: frames_rx,
                    renew: renew_rx,
                },
                &signals,
                &ready_tx,
                &mut ready_sent,
            );
            signals.stop.store(true, Ordering::Release);
            if let Ok(mut snapshot) = signals.snapshot.lock() {
                snapshot.phase = if outcome.is_ok() {
                    WorkerPhase::Stopped
                } else {
                    WorkerPhase::Failed
                };
            }
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
        paused,
        renew,
        snapshot,
        handle: Some(handle),
    })
}
