//! Explicit local acquisition probe. No media is transmitted, read back, or saved.

#[cfg(target_os = "windows")]
fn run() -> Result<(), &'static str> {
    use ss_media_windows::{CaptureStatus, NativeCapture, pick_source};
    use std::time::{Duration, Instant};

    let args: Vec<_> = std::env::args().skip(1).collect();
    let seconds = match args.as_slice() {
        [] => 10,
        [flag, value] if flag == "--seconds" => value
            .parse::<u64>()
            .ok()
            .filter(|value| (1..=120).contains(value))
            .ok_or("Use --seconds 1 through 120")?,
        _ => return Err("Usage: capture_probe [--seconds 1..120]"),
    };
    let window = ss_media_windows::ProbeWindow::open()?;
    // The helper keeps the initialized owning STA/window alive while polling.
    let selected = window
        .wait(unsafe { pick_source(window.handle) })?
        .map_err(|_| "Capture picker failed")?;
    let Some(selected) = selected else {
        println!("Selection canceled; capture did not start.");
        return Ok(());
    };
    let mut capture = NativeCapture::start(selected).map_err(|_| "Capture startup failed")?;
    let started = Instant::now();
    let mut frames = 0_u64;
    let result = (|| {
        while started.elapsed() < Duration::from_secs(seconds) && window.pump() {
            match capture.status().map_err(|_| "Capture status unavailable")? {
                CaptureStatus::Capturing => {}
                CaptureStatus::SourceClosed => break,
                CaptureStatus::Failed(_) => return Err("Capture failed; no fallback was selected"),
                CaptureStatus::Stopped => break,
            }
            if let Some(frame) = capture.take_frame().map_err(|_| "Frame ownership failed")? {
                // Only count acquisition. The texture is released immediately.
                frames = frames.saturating_add(1);
                drop(frame);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    })();
    capture.stop().map_err(|_| "Capture cleanup failed")?;
    result?;
    let counters = capture
        .queue_counters()
        .map_err(|_| "Queue counters unavailable")?;
    println!(
        "Acquired frames: {frames}; elapsed ms: {}; replaced pending frames: {}.",
        started.elapsed().as_millis(),
        counters.replaced
    );
    println!(
        "Acquisition only: no encoding, publication, recording, or measured end-to-end performance."
    );
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
        eprintln!("This explicit WGC probe requires Windows 11.");
        std::process::exit(1);
    }
}
