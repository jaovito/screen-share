use super::{Inner, job::Job};
use ss_media_proof::protocol::{
    self, Command, EncryptionState, SharingReason, SharingState, StartRequest,
};
use std::{
    io::BufReader,
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Child, Command as ProcessCommand, Stdio},
    sync::{
        Arc, Mutex, Weak,
        mpsc::{self, SyncSender},
    },
    thread,
    time::{Duration, Instant},
};

pub(super) struct OwnedEngine {
    child: Child,
    writer: SyncSender<Command>,
    last_seen: Instant,
    stopping: Option<Instant>,
    _job: Job,
}

impl OwnedEngine {
    pub(super) fn terminate_and_wait(&mut self) -> Result<(), &'static str> {
        let _ = self.writer.try_send(Command::Stop {});
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if self
                .child
                .try_wait()
                .map_err(|_| "engine_cleanup_failed")?
                .is_some()
            {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(25));
        }
        self.child.kill().map_err(|_| "engine_cleanup_failed")?;
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if self
                .child
                .try_wait()
                .map_err(|_| "engine_cleanup_failed")?
                .is_some()
            {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(25));
        }
        Err("engine_cleanup_failed")
    }
}

impl Drop for OwnedEngine {
    fn drop(&mut self) {
        // This handle was returned by our fixed sidecar spawn, never a supplied PID.
        let _ = self.child.kill();
    }
}

pub(super) fn start(
    inner: &Arc<Mutex<Inner>>,
    binary: PathBuf,
    request: StartRequest,
) -> Result<(), &'static str> {
    if binary
        .file_name()
        .is_none_or(|name| name != "ss-media-proof.exe")
        || !binary.is_absolute()
        || !binary.is_file()
    {
        let mut state = inner.lock().map_err(|_| "engine_state_failed")?;
        state.snapshot.state = SharingState::EngineMissing;
        state.snapshot.reason = Some(SharingReason::EngineMissing);
        return Err("engine_missing");
    }
    let mut state = inner.lock().map_err(|_| "engine_state_failed")?;
    if state.updating {
        return Err("update_busy");
    }
    if let Some(active) = state.active.as_mut() {
        if active
            .child
            .try_wait()
            .map_err(|_| "engine_state_failed")?
            .is_none()
        {
            return Err("sharing_already_active");
        }
        state.active = None;
    }
    let directory = binary.parent().ok_or("engine_missing")?;
    let mut launch = ProcessCommand::new(&binary);
    launch
        .arg("--desktop-control")
        .current_dir(directory)
        .env_clear();
    // Do not inherit backend credentials, logging switches, or arbitrary loader
    // paths. Windows/COM receive only their ordinary per-user system locations.
    for name in [
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
    ] {
        if let Some(value) = std::env::var_os(name) {
            launch.env(name, value);
        }
    }
    let mut child = launch
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|_| "engine_start_failed")?;
    let job = match Job::own(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };
    let input = child.stdin.take().ok_or("engine_pipe_failed")?;
    let output = child.stdout.take().ok_or("engine_pipe_failed")?;
    state.generation = state
        .generation
        .checked_add(1)
        .ok_or("engine_state_failed")?;
    let generation = state.generation;
    let (sender, receiver) = mpsc::sync_channel(1);
    let profile = request.profile_id.clone();
    state.active = Some(OwnedEngine {
        child,
        writer: sender.clone(),
        last_seen: Instant::now(),
        stopping: None,
        _job: job,
    });
    state.snapshot = protocol::SharingStatus::idle();
    state.snapshot.state = SharingState::Selecting;
    state.snapshot.profile_id = Some(profile);
    drop(state);

    let started = (|| {
        let writer_owner = Arc::downgrade(inner);
        thread::Builder::new()
            .name("native-engine-input".into())
            .spawn(move || {
                let mut input = input;
                while let Ok(command) = receiver.recv() {
                    if protocol::write_packet(&mut input, &command).is_err() {
                        fail(&writer_owner, generation, SharingReason::WorkerFailed);
                        break;
                    }
                }
            })
            .map_err(|_| "engine_pipe_failed")?;
        let output_owner = Arc::downgrade(inner);
        thread::Builder::new()
            .name("native-engine-status".into())
            .spawn(move || {
                let mut output = BufReader::new(output);
                loop {
                    match protocol::read_status(&mut output) {
                        Ok(Some(snapshot)) => {
                            let Some(owner) = output_owner.upgrade() else {
                                break;
                            };
                            let Ok(mut state) = owner.lock() else {
                                break;
                            };
                            if state.generation != generation {
                                break;
                            }
                            if let Some(active) = state.active.as_mut() {
                                active.last_seen = Instant::now();
                            }
                            state.snapshot = snapshot;
                        }
                        Ok(None) => {
                            closed(&output_owner, generation);
                            break;
                        }
                        Err(_) => {
                            fail(&output_owner, generation, SharingReason::WorkerFailed);
                            break;
                        }
                    }
                }
            })
            .map_err(|_| "engine_pipe_failed")?;
        sender
            .try_send(Command::Start { request })
            .map_err(|_| "engine_pipe_failed")
    })();
    if started.is_err() {
        fail(
            &Arc::downgrade(inner),
            generation,
            SharingReason::WorkerFailed,
        );
    }
    started
}

pub(super) fn send(inner: &Arc<Mutex<Inner>>, command: Command) -> Result<(), &'static str> {
    let mut state = inner.lock().map_err(|_| "engine_state_failed")?;
    let current = state.snapshot.state;
    if matches!(command, Command::Pause {}) && current != SharingState::Sharing
        || matches!(command, Command::Resume {}) && current != SharingState::Paused
    {
        return Err("invalid_transition");
    }
    if matches!(command, Command::Stop {}) && state.active.is_none() {
        return Ok(());
    }
    let active = state.active.as_mut().ok_or("sharing_not_active")?;
    if matches!(command, Command::Stop {}) {
        active.stopping = Some(Instant::now());
    }
    active.writer.try_send(command).map_err(|_| "engine_busy")
}

fn fail(owner: &Weak<Mutex<Inner>>, generation: u64, reason: SharingReason) {
    if let Some(owner) = owner.upgrade()
        && let Ok(mut state) = owner.lock()
        && state.generation == generation
    {
        state.active = None;
        state.snapshot.state = SharingState::Failed;
        state.snapshot.encryption = EncryptionState::Pending;
        state.snapshot.reason = Some(reason);
    }
}

fn closed(owner: &Weak<Mutex<Inner>>, generation: u64) {
    if let Some(owner) = owner.upgrade()
        && let Ok(mut state) = owner.lock()
        && state.generation == generation
    {
        let requested = state
            .active
            .as_ref()
            .is_some_and(|active| active.stopping.is_some());
        state.active = None;
        if !matches!(
            state.snapshot.state,
            SharingState::Stopped | SharingState::Failed
        ) {
            state.snapshot.state = if requested {
                SharingState::Stopped
            } else {
                SharingState::Failed
            };
            state.snapshot.reason = Some(if requested {
                SharingReason::StoppedByUser
            } else {
                SharingReason::WorkerFailed
            });
        }
        state.snapshot.encryption = EncryptionState::Pending;
    }
}

pub(super) fn monitor(owner: Weak<Mutex<Inner>>) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(250));
            let Some(owner) = owner.upgrade() else {
                break;
            };
            let Ok(mut state) = owner.lock() else {
                break;
            };
            let Some(active) = state.active.as_mut() else {
                continue;
            };
            let exited = active.child.try_wait();
            let requested = active.stopping.is_some();
            let hung = active.last_seen.elapsed() > Duration::from_secs(10)
                || active
                    .stopping
                    .is_some_and(|started| started.elapsed() > Duration::from_secs(8));
            if matches!(exited, Ok(Some(_))) || exited.is_err() || hung {
                let failed_exit = matches!(exited.as_ref(), Ok(Some(status)) if !status.success())
                    || exited.is_err();
                state.active = None;
                if !matches!(
                    state.snapshot.state,
                    SharingState::Stopped | SharingState::Failed
                ) {
                    state.snapshot.state = if !requested && (hung || failed_exit) {
                        SharingState::Failed
                    } else {
                        SharingState::Stopped
                    };
                    state.snapshot.reason = Some(if hung {
                        SharingReason::ChildUnresponsive
                    } else if !requested && failed_exit {
                        SharingReason::WorkerFailed
                    } else {
                        SharingReason::StoppedByUser
                    });
                }
                state.snapshot.encryption = EncryptionState::Pending;
            }
        }
    });
}
