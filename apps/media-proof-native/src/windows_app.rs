use crate::{pipeline, private_key};
use ss_domain::VideoProfile;
use ss_media_windows::{CaptureStatus, NativeCapture, PickedSource, ProbeWindow, pick_source};
use ss_rtc_livekit::native_proof::PublisherGrant;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::TryRecvError,
    },
    time::{Duration, Instant},
};

struct Arguments {
    grant: PathBuf,
    key_output: PathBuf,
    profile: VideoProfile,
    bitrate: u32,
    seconds: u64,
}

impl Arguments {
    fn parse() -> Result<Self, &'static str> {
        let mut grant = None;
        let mut key_output = None;
        let (mut height, mut fps, mut bitrate, mut seconds) = (1080, 60, 10_000_000, 30);
        let args: Vec<_> = std::env::args().skip(1).collect();
        if args.is_empty() || args.len() % 2 != 0 {
            return Err(
                "Pass --publisher-grant <file> --private-key-output <absolute-file>, optionally --height --fps --bitrate-bps --seconds.",
            );
        }
        for pair in args.as_chunks::<2>().0 {
            match pair[0].as_str() {
                "--publisher-grant" if grant.is_none() => grant = Some(PathBuf::from(&pair[1])),
                "--private-key-output" if key_output.is_none() => {
                    key_output = Some(PathBuf::from(&pair[1]))
                }
                "--height" => height = pair[1].parse().map_err(|_| "Invalid catalog height")?,
                "--fps" => fps = pair[1].parse().map_err(|_| "Invalid catalog frame rate")?,
                "--bitrate-bps" => bitrate = pair[1].parse().map_err(|_| "Invalid bitrate")?,
                "--seconds" => seconds = pair[1].parse().map_err(|_| "Invalid proof duration")?,
                _ => return Err("Unknown or duplicate private input argument"),
            }
        }
        let profile = VideoProfile::new(height, fps).map_err(|_| "Invalid catalog profile")?;
        if !(64_000..=50_000_000).contains(&bitrate) || !(1..=240).contains(&seconds) {
            return Err("Bitrate must be 64000..50000000 and duration 1..240 seconds");
        }
        Ok(Self {
            grant: grant.ok_or("A trusted publisher grant file is required")?,
            key_output: key_output.ok_or("An explicit private key export path is required")?,
            profile,
            bitrate,
            seconds,
        })
    }
}

pub fn run() -> Result<(), &'static str> {
    let args = Arguments::parse()?;
    let json = crate::input::read_grant(&args.grant)?;
    let grant =
        PublisherGrant::from_json(&json).map_err(|_| "Invalid or expired publisher grant")?;
    let window = ProbeWindow::open()?;
    let source = window
        .wait(unsafe { pick_source(window.handle) })?
        .map_err(|_| "Source selection failed")?;
    let Some(source) = source else {
        println!("Selection canceled. No capture or publication started.");
        return Ok(());
    };
    let (key, key_export) = private_key::generate_and_export(&args.key_output)?;
    let mut worker = pipeline::spawn(grant, key, args.profile, args.bitrate)?;
    // A native driver can block inside its own COM call. Bound only this explicitly
    // launched proof process; never attempt to kill another user's application.
    let complete = Arc::new(AtomicBool::new(false));
    let watchdog_complete = complete.clone();
    let watchdog_stop = worker.stop.clone();
    let timeout = Duration::from_secs(args.seconds + 40);
    std::thread::spawn(move || {
        std::thread::sleep(timeout);
        if !watchdog_complete.load(Ordering::Acquire) {
            watchdog_stop.store(true, Ordering::Release);
            eprintln!("Native proof deadline exceeded; terminating only the proof process.");
            ss_media_windows::terminate_probe();
        }
    });
    let mut capture = None;
    let result = share(&window, source, &mut capture, &worker, args.seconds);
    worker.stop.store(true, Ordering::Release);
    let capture_cleanup = capture.as_mut().map_or(Ok(()), |capture| {
        capture.stop().map_err(|_| "Capture cleanup failed")
    });
    drop(capture);
    let cleanup_deadline = Instant::now() + Duration::from_secs(8);
    while worker
        .handle
        .as_ref()
        .is_some_and(|handle| !handle.is_finished())
    {
        let _ = window.pump();
        if Instant::now() >= cleanup_deadline {
            eprintln!("Native proof cleanup timed out; terminating only the proof process.");
            ss_media_windows::terminate_probe();
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let joined = worker
        .handle
        .take()
        .ok_or("Native worker missing")?
        .join()
        .map_err(|_| "Native worker failed");
    complete.store(true, Ordering::Release);
    drop(key_export);
    joined?;
    capture_cleanup?;
    result?;
    let report = worker
        .result
        .try_recv()
        .map_err(|_| "Native worker report unavailable")??;
    if report.access_units == 0 {
        return Err("No encoded access units were accepted; the proof did not pass");
    }
    println!(
        "Native proof finished. Captured frames consumed: {}; encoder samples: {}; H.264 access units: {}; encoded bytes accepted by SDK: {}; bitrate updates: {}; keyframe requests: {}.",
        report.frames_consumed,
        report.samples_submitted,
        report.access_units,
        report.bytes_sent,
        report.rate_updates,
        report.keyframe_requests
    );
    println!(
        "These counters do not prove decoded playback, wire bitrate, E2EE validation, or performance targets. Run the two-PC validation protocol."
    );
    Ok(())
}

fn share(
    window: &ProbeWindow,
    source: PickedSource,
    capture: &mut Option<NativeCapture>,
    worker: &pipeline::Worker,
    seconds: u64,
) -> Result<(), &'static str> {
    let readiness_deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if !window.pump() {
            return Ok(());
        }
        match worker.ready.try_recv() {
            Ok(result) => {
                result?;
                break;
            }
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => return Err("Native authorization worker stopped"),
        }
        if worker.stop.load(Ordering::Acquire) || Instant::now() >= readiness_deadline {
            return Err("Encrypted publication preparation did not complete");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if worker.stop.load(Ordering::Acquire) {
        return Err("Authorization expired before capture startup");
    }
    // The original picker item cannot be substituted. No frames are accepted by
    // the worker until its independently validated encrypted publication is ready.
    let active = NativeCapture::start(source).map_err(|_| "Native capture startup failed")?;
    let reader = active.reader();
    *capture = Some(active);
    worker
        .frames
        .try_send(reader)
        .map_err(|_| "Native capture handoff failed")?;
    println!(
        "Capture started for the explicitly selected source; encoded output and receiver playback are not yet confirmed. Deliver the private key only through your established encrypted channel. Close this window to stop."
    );
    let started = Instant::now();
    while window.pump() && started.elapsed() < Duration::from_secs(seconds) {
        if worker.stop.load(Ordering::Acquire)
            || worker
                .handle
                .as_ref()
                .is_some_and(|handle| handle.is_finished())
        {
            break;
        }
        match capture
            .as_ref()
            .ok_or("Capture ownership lost")?
            .status()
            .map_err(|_| "Capture status unavailable")?
        {
            CaptureStatus::Capturing => {}
            CaptureStatus::SourceClosed | CaptureStatus::Stopped => break,
            CaptureStatus::Failed(_) => {
                return Err("Selected-source capture failed; no replacement was selected");
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}
