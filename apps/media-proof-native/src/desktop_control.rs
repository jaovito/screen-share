mod session;

use session::Session;
use ss_media_proof::protocol::{
    self, Command, EncryptionState, SharingReason, SharingState, SharingStatus,
};
use std::{
    io::BufReader,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

pub(super) struct Guard {
    started: Instant,
    heartbeat: Arc<AtomicU64>,
    complete: Arc<AtomicBool>,
}

impl Guard {
    fn new() -> Self {
        let started = Instant::now();
        let heartbeat = Arc::new(AtomicU64::new(0));
        let complete = Arc::new(AtomicBool::new(false));
        let watched = heartbeat.clone();
        let done = complete.clone();
        std::thread::spawn(move || {
            while !done.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(500));
                let now = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                if now.saturating_sub(watched.load(Ordering::Acquire)) > 10_000 {
                    // This code runs only in the isolated owned engine executable.
                    ss_media_windows::terminate_probe();
                }
            }
        });
        Self {
            started,
            heartbeat,
            complete,
        }
    }

    pub fn touch(&self) {
        self.heartbeat.store(
            self.started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            Ordering::Release,
        );
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        self.complete.store(true, Ordering::Release);
    }
}

pub fn run() -> Result<(), &'static str> {
    let guard = Guard::new();
    let disconnected = Arc::new(AtomicBool::new(false));
    let peer_closed = disconnected.clone();
    let (send, input) = mpsc::sync_channel(4);
    std::thread::Builder::new()
        .name("desktop-private-control".into())
        .spawn(move || {
            let mut source = BufReader::new(std::io::stdin());
            loop {
                match protocol::read_command(&mut source) {
                    Ok(Some(command)) => {
                        if send.send(command).is_err() {
                            break;
                        }
                    }
                    _ => {
                        peer_closed.store(true, Ordering::Release);
                        let _ = send.try_send(Command::Stop {});
                        break;
                    }
                }
            }
        })
        .map_err(|_| "Control pipe failed")?;
    let mut status = SharingStatus::idle();
    status.audio_supported = true;
    let first = loop {
        guard.touch();
        if disconnected.load(Ordering::Acquire) {
            return Ok(());
        }
        match input.recv_timeout(Duration::from_millis(100)) {
            Ok(Command::Start { request }) => break request,
            Ok(Command::Stop {}) => return Ok(()),
            Ok(_) => return Err("Invalid initial control command"),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    };
    let result = Session::run(first, &input, &disconnected, &guard, &mut status);
    if let Err(reason) = result {
        status.state = SharingState::Failed;
        status.reason = Some(reason);
        status.encryption = EncryptionState::Pending;
        let _ = emit(&status);
        return Err("Native publisher stopped after a validated control or media failure");
    }
    status.state = SharingState::Stopped;
    status.encryption = EncryptionState::Pending;
    emit(&status)
}

pub(super) fn emit(status: &SharingStatus) -> Result<(), &'static str> {
    // Only this closed metadata schema reaches stdout. Secrets and media are not
    // fields of SharingStatus and SDK diagnostics are not forwarded by the host.
    protocol::write_packet(&mut std::io::stdout().lock(), status)
}

pub(super) fn profile(value: &str) -> Result<ss_domain::VideoProfile, SharingReason> {
    let (height, fps) = value.split_once('p').ok_or(SharingReason::InvalidRequest)?;
    ss_domain::VideoProfile::new(
        height.parse().map_err(|_| SharingReason::InvalidRequest)?,
        fps.parse().map_err(|_| SharingReason::InvalidRequest)?,
    )
    .map_err(|_| SharingReason::InvalidRequest)
}
