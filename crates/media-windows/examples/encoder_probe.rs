//! Explicit local acquisition/encoding experiment. No encoded content is saved
//! or transmitted. A successful run is not E2EE, RTC, or a performance benchmark.

#[cfg(target_os = "windows")]
#[path = "support/encoder.rs"]
mod encoder;

#[cfg(target_os = "windows")]
fn run() -> Result<(), &'static str> {
    use ss_domain::VideoProfile;
    use ss_media_windows::{NativeCapture, pick_source};
    use std::{
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        time::{Duration, Instant},
    };

    let args: Vec<_> = std::env::args().skip(1).collect();
    let (mut seconds, mut height, mut fps) = (10, 1080, 60);
    let mut seen = std::collections::HashSet::new();
    if args.len() % 2 != 0 {
        return Err(
            "Usage: encoder_probe [--seconds 1..120] [--height 480|720|1080|1440] [--fps 30|60]",
        );
    }
    for pair in args.as_chunks::<2>().0 {
        if !seen.insert(pair[0].as_str()) {
            return Err("Duplicate encoder probe option");
        }
        match pair[0].as_str() {
            "--seconds" => {
                seconds = pair[1]
                    .parse::<u64>()
                    .ok()
                    .filter(|value| (1..=120).contains(value))
                    .ok_or("Use --seconds 1 through 120")?
            }
            "--height" => {
                height = pair[1]
                    .parse::<u16>()
                    .map_err(|_| "Invalid profile height")?
            }
            "--fps" => fps = pair[1].parse::<u8>().map_err(|_| "Invalid profile FPS")?,
            _ => return Err("Unknown encoder probe option"),
        }
    }
    let profile = VideoProfile::new(height, fps)
        .map_err(|_| "Select a catalog profile: 480/720/1080/1440 and 30/60 FPS")?;
    let initial_bitrate = match height {
        480 => 2_000_000,
        720 => 4_000_000,
        1080 => 8_000_000,
        1440 => 14_000_000,
        _ => return Err("Invalid profile height"),
    };
    println!(
        "Local encoder probe: {}x{} at target {} FPS for {seconds}s.",
        profile.width, profile.height, profile.fps
    );
    println!(
        "Declared actions: request startup keyframe; halve target bitrate halfway through the run."
    );
    println!("No recording, publication, audio, E2EE, or end-to-end performance verification.");
    let window = ss_media_windows::ProbeWindow::open()?;
    let selected = window
        .wait(unsafe { pick_source(window.handle) })?
        .map_err(|_| "Capture picker failed")?;
    let Some(selected) = selected else {
        println!("Selection canceled; capture/encoding did not start.");
        return Ok(());
    };

    // This watchdog terminates only this explicitly launched diagnostic process
    // if a native driver call prevents shutdown. It never targets another process.
    let _watchdog = encoder::Watchdog::start(Duration::from_secs(seconds + 5))?;
    let mut capture = NativeCapture::start(selected).map_err(|_| "Capture startup failed")?;
    let stop = Arc::new(AtomicBool::new(false));
    let started = Instant::now();
    let worker = encoder::spawn(
        capture.reader(),
        stop.clone(),
        profile,
        initial_bitrate,
        Duration::from_secs(seconds),
    )?;
    while started.elapsed() < Duration::from_secs(seconds) && !worker.is_finished() && window.pump()
    {
        std::thread::sleep(Duration::from_millis(10));
    }
    stop.store(true, Ordering::Release);
    let capture_stopped = capture.stop().map_err(|_| "Capture cleanup failed");
    while !worker.is_finished() {
        let _ = window.pump();
        std::thread::sleep(Duration::from_millis(10));
    }
    let result = worker.join().map_err(|_| "Encoder worker failed")?;
    capture_stopped?;
    let report = result?;
    let counters = capture
        .queue_counters()
        .map_err(|_| "Capture counters unavailable")?;
    println!(
        "Acquired frames: {}; consumed frames: {}; submitted samples: {}; encoded access units: {}; encoded bytes: {}.",
        counters.accepted, report.consumed, report.submitted, report.encoded, report.bytes
    );
    println!(
        "Queue replacements: {}; validated keyframes: {}; elapsed ms: {}.",
        counters.replaced,
        report.keyframes,
        started.elapsed().as_millis()
    );
    println!(
        "Encoder cleanup completed; keyframe request applied: {}; bitrate change applied: {}.",
        report.keyframe_requested, report.bitrate_changed
    );
    if report.encoded == 0 {
        return Err("No encoded output was produced; this run does not validate the encoder");
    }
    Ok(())
}

fn main() {
    #[cfg(target_os = "windows")]
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("This explicit hardware encoder probe requires Windows 11.");
        std::process::exit(1);
    }
}
