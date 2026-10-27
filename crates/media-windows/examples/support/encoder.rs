use ss_domain::VideoProfile;
use ss_media_windows::{
    CaptureReader, CaptureStatus, EncoderPoll, HardwareEncoder, NativeFrame, SubmitOutcome,
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};

#[derive(Default)]
pub struct Report {
    pub consumed: u64,
    pub submitted: u64,
    pub encoded: u64,
    pub bytes: u64,
    pub keyframes: u64,
    pub keyframe_requested: bool,
    pub bitrate_changed: bool,
}

/// A deadline for this process, not permission to terminate arbitrary applications.
/// Keep the guard alive through native capture/MFT cleanup to cover driver hangs.
pub struct Watchdog {
    completed: Option<SyncSender<()>>,
    worker: Option<JoinHandle<()>>,
}

impl Watchdog {
    pub fn start(timeout: Duration) -> Result<Self, &'static str> {
        let (completed, wait) = mpsc::sync_channel(1);
        let worker = thread::Builder::new().name("probe-watchdog".into()).spawn(move || {
            if let Err(mpsc::RecvTimeoutError::Timeout) = wait.recv_timeout(timeout) {
                eprintln!("Native probe exceeded its shutdown deadline; terminating this diagnostic process only.");
                ss_media_windows::terminate_probe();
            }
        }).map_err(|_| "Probe watchdog could not start")?;
        Ok(Self {
            completed: Some(completed),
            worker: Some(worker),
        })
    }
}

impl Drop for Watchdog {
    fn drop(&mut self) {
        if let Some(completed) = self.completed.take() {
            let _ = completed.send(());
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

struct Mta;
impl Mta {
    fn open() -> Result<Self, &'static str> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|_| "Encoder MTA initialization failed")?;
        Ok(Self)
    }
}
impl Drop for Mta {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub fn spawn(
    reader: CaptureReader,
    stop: Arc<AtomicBool>,
    profile: VideoProfile,
    bitrate: u32,
    duration: Duration,
) -> Result<JoinHandle<Result<Report, &'static str>>, &'static str> {
    thread::Builder::new()
        .name("hardware-encoder-probe".into())
        .spawn(move || run(reader, stop, profile, bitrate, duration))
        .map_err(|_| "Encoder worker could not start")
}

fn run(
    reader: CaptureReader,
    stop: Arc<AtomicBool>,
    profile: VideoProfile,
    bitrate: u32,
    duration: Duration,
) -> Result<Report, &'static str> {
    let _mta = Mta::open()?;
    let started = Instant::now();
    let mut report = Report::default();
    let mut encoder = None;
    let mut pending: Option<NativeFrame> = None;
    let mut last_submitted_timestamp = None;
    let frame_interval = 10_000_000 / i64::from(profile.fps);
    let result = (|| {
        while !stop.load(Ordering::Acquire) && started.elapsed() < duration {
            match reader.status().map_err(|_| "Capture status unavailable")? {
                CaptureStatus::Capturing => {}
                CaptureStatus::Stopped | CaptureStatus::SourceClosed => break,
                CaptureStatus::Failed(_) => {
                    return Err("Capture failed during the local encoder probe");
                }
            }
            if let Some(frame) = reader
                .take_frame()
                .map_err(|_| "Native frame ownership failed")?
            {
                report.consumed = report.consumed.saturating_add(1);
                // One pending native texture. Backpressure replaces it with the
                // latest capture; no secondary channel or historical queue exists.
                pending = Some(frame);
            }
            if encoder.is_none()
                && let Some(frame) = pending.as_ref()
            {
                let initialized = HardwareEncoder::new(frame, profile, bitrate).map_err(
                    |_| "Hardware encoder initialization failed or capabilities are unsupported",
                )?;
                // Retain ownership before any further fallible operation so the
                // terminal explicit stop result is checked even after a failure.
                encoder = Some(initialized);
                if !capture_running(&reader, &stop, started, duration)? {
                    break;
                }
                encoder
                    .as_mut()
                    .ok_or("Encoder initialization state unavailable")?
                    .request_keyframe()
                    .map_err(|_| "Startup keyframe request failed")?;
                report.keyframe_requested = true;
            }
            if !capture_running(&reader, &stop, started, duration)? {
                break;
            }
            if let Some(encoder) = encoder.as_mut() {
                if !report.bitrate_changed && started.elapsed() >= duration / 2 {
                    encoder
                        .set_bitrate(bitrate / 2)
                        .map_err(|_| "Declared bitrate change failed")?;
                    report.bitrate_changed = true;
                }
                for _ in 0..8 {
                    match encoder
                        .poll()
                        .map_err(|_| "Asynchronous hardware encoder output failed")?
                    {
                        EncoderPoll::Pending => break,
                        EncoderPoll::NeedInput => {}
                        EncoderPoll::Output(unit) => {
                            report.encoded = report.encoded.saturating_add(1);
                            report.bytes = report.bytes.saturating_add(unit.payload().len() as u64);
                            if unit.is_keyframe() {
                                report.keyframes = report.keyframes.saturating_add(1);
                            }
                            // The complete validated access unit is discarded here.
                            // No file, socket, recording, content log, or RTC SDK.
                            drop(unit);
                        }
                    }
                }
                if !capture_running(&reader, &stop, started, duration)? {
                    break;
                }
                if let Some(frame) = pending.as_ref() {
                    // Half a millisecond accommodates WGC cadence rounding without
                    // presenting the configured target as an observed frame rate.
                    let due = last_submitted_timestamp.is_none_or(|previous| {
                        frame.timestamp_100ns().saturating_sub(previous) >= frame_interval - 5000
                    });
                    if due {
                        match encoder
                            .submit(frame)
                            .map_err(|_| "GPU conversion or encoder input failed")?
                        {
                            SubmitOutcome::Accepted => {
                                report.submitted = report.submitted.saturating_add(1);
                                last_submitted_timestamp = Some(frame.timestamp_100ns());
                                pending = None;
                            }
                            SubmitOutcome::Backpressure => {}
                        }
                    }
                }
            }
            // Bounded timer polling without a busy spin; at most eight native
            // event operations per tick and two MFT samples remain in flight.
            thread::sleep(Duration::from_millis(2));
        }
        Ok(())
    })();
    drop(pending);
    let cleanup = if let Some(encoder) = encoder.as_mut() {
        encoder
            .stop()
            .map_err(|_| "Hardware encoder cleanup failed")
    } else {
        Ok(())
    };
    cleanup?;
    result?;

    Ok(report)
}

fn capture_running(
    reader: &CaptureReader,
    stop: &AtomicBool,
    started: Instant,
    duration: Duration,
) -> Result<bool, &'static str> {
    if stop.load(Ordering::Acquire) || started.elapsed() >= duration {
        return Ok(false);
    }
    match reader.status().map_err(|_| "Capture status unavailable")? {
        CaptureStatus::Capturing => Ok(true),
        CaptureStatus::Stopped | CaptureStatus::SourceClosed => Ok(false),
        CaptureStatus::Failed(_) => Err("Capture failed during the local encoder probe"),
    }
}
