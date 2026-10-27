//! Native lease renewal is independent of WebView timers and never trusts a renderer token.
use crate::{engine::Engine, engine_binary};
use ss_control_client::{ControlClient, ControlRequest, Method};
use ss_media_proof::protocol::{
    AudioMode, GrantPacket, RenewRequest, SharingState, SharingStatus, StartRequest,
};
use std::{sync::Mutex, time::Duration};
use tauri::Manager;
use tokio::sync::watch;

#[derive(Clone)]
struct Binding {
    room_id: String,
    session_id: String,
    epoch: u64,
    rtc_room: String,
    participant: String,
    server_url: String,
    include_audio: bool,
}

impl Binding {
    fn new(room_id: String, request: &StartRequest) -> Result<Self, &'static str> {
        if !uuid_shape(&room_id) {
            return Err("invalid_room");
        }
        request.validate()?;
        Ok(Self {
            room_id,
            session_id: request.grant.session_id.clone(),
            epoch: request.grant.epoch,
            rtc_room: request.grant.rtc_room.clone(),
            participant: request.grant.participant_id.clone(),
            server_url: request.grant.server_url.clone(),
            include_audio: request.audio_mode != AudioMode::Off,
        })
    }

    fn validate(&self, grant: &GrantPacket) -> Result<(), &'static str> {
        grant.validate()?;
        if grant.session_id != self.session_id
            || grant.epoch != self.epoch
            || grant.rtc_room != self.rtc_room
            || grant.participant_id != self.participant
            || grant.publisher_id != self.participant
            || grant.server_url != self.server_url
        {
            return Err("authorization_binding_changed");
        }
        Ok(())
    }

    async fn fetch(&self, client: &ControlClient) -> Result<GrantPacket, &'static str> {
        let response = client
            .request(ControlRequest {
                method: Method::Post,
                path: format!("/v1/rooms/{}/grants", self.room_id),
                body: Some(
                    serde_json::json!({ "role": "publisher", "sessionId": self.session_id,
                "epoch": self.epoch, "includeAudio": self.include_audio }),
                ),
            })
            .await
            .map_err(|_| "authorization_unavailable")?;
        parse_response(self, response.status, response.body)
    }
}

fn uuid_shape(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn parse_response(
    binding: &Binding,
    status: u16,
    mut body: serde_json::Value,
) -> Result<GrantPacket, &'static str> {
    if !(200..300).contains(&status) {
        return Err("authorization_denied");
    }
    let grant = body.get_mut("grant").ok_or("authorization_invalid")?.take();
    let grant: GrantPacket = serde_json::from_value(grant).map_err(|_| "authorization_invalid")?;
    binding.validate(&grant)?;
    Ok(grant)
}

struct Current {
    nonce: u64,
    binding: Option<Binding>,
    refreshing: bool,
    suspended: u32,
}

pub struct Authorization {
    current: Mutex<Current>,
    changed: watch::Sender<u64>,
}

impl Authorization {
    pub fn new() -> Self {
        let (changed, _) = watch::channel(0);
        Self {
            current: Mutex::new(Current {
                nonce: 0,
                binding: None,
                refreshing: false,
                suspended: 0,
            }),
            changed,
        }
    }

    fn reserve(&self, binding: Binding, engine: &Engine) -> Result<u64, &'static str> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "authorization_state_failed")?;
        if current.suspended > 0 {
            return Err("authorization_busy");
        }
        if current.refreshing || is_active(engine.status()?.state) {
            return Err("sharing_already_active");
        }
        current.nonce = current
            .nonce
            .checked_add(1)
            .ok_or("authorization_state_failed")?;
        current.binding = Some(binding);
        current.refreshing = true;
        self.changed.send_replace(current.nonce);
        Ok(current.nonce)
    }

    fn with_current<T>(
        &self,
        nonce: u64,
        operation: impl FnOnce() -> Result<T, &'static str>,
    ) -> Result<T, &'static str> {
        let current = self
            .current
            .lock()
            .map_err(|_| "authorization_state_failed")?;
        if current.nonce != nonce || current.binding.is_none() {
            return Err("authorization_cancelled");
        }
        operation()
    }

    fn binding(&self) -> Result<(u64, Binding), &'static str> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "authorization_state_failed")?;
        if current.refreshing {
            return Err("authorization_busy");
        }
        let binding = current.binding.clone().ok_or("sharing_not_active")?;
        current.refreshing = true;
        Ok((current.nonce, binding))
    }

    fn begin_refresh(&self, nonce: u64) -> Result<(), &'static str> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "authorization_state_failed")?;
        if current.nonce != nonce || current.binding.is_none() {
            return Err("authorization_cancelled");
        }
        if current.refreshing {
            return Err("authorization_busy");
        }
        current.refreshing = true;
        Ok(())
    }

    fn finish_refresh(&self, nonce: u64) {
        if let Ok(mut current) = self.current.lock()
            && current.nonce == nonce
        {
            current.refreshing = false;
        }
    }

    fn fail(&self, nonce: u64, engine: &Engine) {
        if let Ok(mut current) = self.current.lock()
            && current.nonce == nonce
            && current.binding.is_some()
        {
            current.binding = None;
            current.refreshing = false;
            current.nonce = current.nonce.saturating_add(1);
            self.changed.send_replace(current.nonce);
            if engine.status().is_ok_and(|status| is_active(status.state)) {
                engine.revoke_authorization();
            }
        }
    }

    pub fn stop(&self, engine: &Engine) -> Result<SharingStatus, &'static str> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "authorization_state_failed")?;
        current.nonce = current
            .nonce
            .checked_add(1)
            .ok_or("authorization_state_failed")?;
        current.binding = None;
        current.refreshing = false;
        self.changed.send_replace(current.nonce);
        engine.stop()
    }

    pub fn suspend(&self, engine: &Engine) -> Result<Suspension<'_>, &'static str> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "authorization_state_failed")?;
        current.suspended = current
            .suspended
            .checked_add(1)
            .ok_or("authorization_state_failed")?;
        current.nonce = current.nonce.saturating_add(1);
        current.binding = None;
        current.refreshing = false;
        self.changed.send_replace(current.nonce);
        let _ = engine.stop();
        Ok(Suspension(self))
    }

    pub fn invalidate(&self) {
        if let Ok(mut current) = self.current.lock() {
            current.nonce = current.nonce.saturating_add(1);
            current.binding = None;
            current.refreshing = false;
            self.changed.send_replace(current.nonce);
        }
    }
}

pub struct Suspension<'a>(&'a Authorization);
impl Drop for Suspension<'_> {
    fn drop(&mut self) {
        if let Ok(mut current) = self.0.current.lock() {
            current.suspended = current.suspended.saturating_sub(1);
        }
    }
}

fn is_active(state: SharingState) -> bool {
    matches!(
        state,
        SharingState::Selecting
            | SharingState::Connecting
            | SharingState::Sharing
            | SharingState::Paused
    )
}

pub async fn start(
    app: tauri::AppHandle,
    room_id: String,
    mut request: StartRequest,
) -> Result<SharingStatus, &'static str> {
    let binding = Binding::new(room_id, &request)?;
    let manager = app.state::<Authorization>();
    let engine = app.state::<Engine>();
    let nonce = manager.reserve(binding.clone(), &engine)?;
    let client = app.state::<ControlClient>().inner().clone();
    let result = async {
        request.grant = binding.fetch(&client).await?;
        manager.with_current(nonce, || engine.start(engine_binary(&app)?, request))
    }
    .await;
    match result {
        Ok(status) => {
            manager.finish_refresh(nonce);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                renew_loop(app, client, nonce, binding).await;
            });
            Ok(status)
        }
        Err(error) => {
            manager.fail(nonce, &engine);
            Err(error)
        }
    }
}

pub async fn renew(
    app: tauri::AppHandle,
    supplied: GrantPacket,
    profile_id: Option<String>,
    bitrate_bps: Option<u32>,
) -> Result<SharingStatus, &'static str> {
    let manager = app.state::<Authorization>();
    let engine = app.state::<Engine>();
    let (nonce, binding) = manager.binding()?;
    if let Err(error) = binding.validate(&supplied) {
        manager.finish_refresh(nonce);
        return Err(error);
    }
    let result = async {
        let grant = binding.fetch(&app.state::<ControlClient>()).await?;
        manager.with_current(nonce, || {
            engine.renew(RenewRequest {
                grant,
                profile_id,
                bitrate_bps,
            })
        })
    }
    .await;
    manager.finish_refresh(nonce);
    if result.is_err() {
        manager.fail(nonce, &engine);
    }
    result
}

async fn renew_loop(app: tauri::AppHandle, client: ControlClient, nonce: u64, binding: Binding) {
    let manager = app.state::<Authorization>();
    let engine = app.state::<Engine>();
    let mut changes = manager.changed.subscribe();
    loop {
        if manager.with_current(nonce, || Ok(())).is_err() {
            return;
        }
        if tokio::time::timeout(Duration::from_secs(20), changes.changed())
            .await
            .is_ok()
        {
            return;
        }
        match engine.status() {
            Ok(status) if is_active(status.state) => {}
            _ => {
                manager.fail(nonce, &engine);
                return;
            }
        }
        match manager.begin_refresh(nonce) {
            Ok(()) => {}
            Err("authorization_busy") => continue,
            _ => return,
        }
        let result = binding.fetch(&client).await.and_then(|grant| {
            manager
                .with_current(nonce, || {
                    engine.renew(RenewRequest {
                        grant,
                        profile_id: None,
                        bitrate_bps: None,
                    })
                })
                .map(|_| ())
        });
        manager.finish_refresh(nonce);
        if result.is_err() {
            manager.fail(nonce, &engine);
            return;
        }
    }
}

#[cfg(test)]
mod tests;
