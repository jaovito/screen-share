use ss_media_proof::protocol::{
    Command, EncryptionState, RenewRequest, SharingReason, SharingState, SharingStatus,
    StartRequest,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[cfg(target_os = "windows")]
mod job;
#[cfg(target_os = "windows")]
mod process;

pub struct Engine {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    snapshot: SharingStatus,
    updating: bool,
    #[cfg(target_os = "windows")]
    active: Option<process::OwnedEngine>,
    #[cfg(target_os = "windows")]
    generation: u64,
}

impl Engine {
    pub fn new() -> Self {
        let mut snapshot = SharingStatus::idle();
        snapshot.audio_supported = cfg!(target_os = "windows");
        if !cfg!(target_os = "windows") {
            snapshot.state = SharingState::UnsupportedPlatform;
            snapshot.reason = Some(SharingReason::UnsupportedPlatform);
        }
        let inner = Arc::new(Mutex::new(Inner {
            snapshot,
            updating: false,
            #[cfg(target_os = "windows")]
            active: None,
            #[cfg(target_os = "windows")]
            generation: 0,
        }));
        #[cfg(target_os = "windows")]
        process::monitor(Arc::downgrade(&inner));
        Self { inner }
    }

    pub fn status(&self) -> Result<SharingStatus, &'static str> {
        self.inner
            .lock()
            .map(|state| state.snapshot.clone())
            .map_err(|_| "engine_state_failed")
    }

    pub fn start(
        &self,
        binary: PathBuf,
        request: StartRequest,
    ) -> Result<SharingStatus, &'static str> {
        request.validate()?;
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (binary, request);
            Err("unsupported_platform")
        }
        #[cfg(target_os = "windows")]
        {
            process::start(&self.inner, binary, request)?;
            self.status()
        }
    }

    pub async fn stop_for_update(&self) -> Result<(), &'static str> {
        #[cfg(target_os = "windows")]
        let active;
        {
            let mut inner = self.inner.lock().map_err(|_| "engine_state_failed")?;
            if inner.updating {
                return Err("update_busy");
            }
            inner.updating = true;
            #[cfg(target_os = "windows")]
            {
                inner.generation = inner.generation.wrapping_add(1);
                active = inner.active.take();
            }
            inner.snapshot.state = SharingState::Stopped;
            inner.snapshot.encryption = EncryptionState::Pending;
        }
        #[cfg(target_os = "windows")]
        if let Some(mut active) = active {
            let stopped = tauri::async_runtime::spawn_blocking(move || active.terminate_and_wait())
                .await
                .unwrap_or(Err("engine_cleanup_failed"));
            if stopped.is_err() {
                self.finish_update();
            }
            stopped?;
        }
        Ok(())
    }

    pub fn revoke_authorization(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            #[cfg(target_os = "windows")]
            {
                inner.generation = inner.generation.wrapping_add(1);
                // Dropping the owned job closes only this app's bundled publisher process.
                inner.active = None;
            }
            inner.snapshot.state = SharingState::Failed;
            inner.snapshot.reason = Some(SharingReason::AuthorizationFailed);
            inner.snapshot.encryption = EncryptionState::Pending;
        }
    }

    pub fn finish_update(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.updating = false;
        }
    }

    pub fn pause(&self) -> Result<SharingStatus, &'static str> {
        self.send(Command::Pause {})
    }
    pub fn resume(&self) -> Result<SharingStatus, &'static str> {
        self.send(Command::Resume {})
    }
    pub fn stop(&self) -> Result<SharingStatus, &'static str> {
        self.send(Command::Stop {})
    }
    pub fn renew(&self, request: RenewRequest) -> Result<SharingStatus, &'static str> {
        request.validate()?;
        self.send(Command::Renew { request })
    }

    fn send(&self, command: Command) -> Result<SharingStatus, &'static str> {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = command;
            Err("unsupported_platform")
        }
        #[cfg(target_os = "windows")]
        {
            process::send(&self.inner, command)?;
            self.status()
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.inner.lock() {
            #[cfg(target_os = "windows")]
            {
                inner.active = None;
            }
            inner.snapshot.state = SharingState::Stopped;
            inner.snapshot.encryption = EncryptionState::Pending;
        }
    }
}
