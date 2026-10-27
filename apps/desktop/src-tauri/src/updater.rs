//! Fixed-origin, bounded update transport. Only the official updater verifies and installs packages.
use crate::engine::Engine;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::{
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::Url;
use tauri_plugin_updater::{Update, UpdaterExt};

const METADATA_LIMIT: usize = 64 * 1024;
const PACKAGE_LIMIT: usize = 512 * 1024 * 1024;
const PENDING_LIFETIME: Duration = Duration::from_secs(15 * 60);

pub struct Settings {
    key: String,
    endpoint: Url,
}

impl Settings {
    pub fn parse(key: Option<&str>, endpoint: Option<&str>) -> Option<Self> {
        let (key, endpoint) = (key?, endpoint?);
        if key.len() > 4096 {
            return None;
        }
        let decoded = STANDARD.decode(key).ok()?;
        minisign_verify::PublicKey::decode(std::str::from_utf8(&decoded).ok()?).ok()?;
        let endpoint = secure_url(endpoint).ok()?;
        Some(Self {
            key: key.to_owned(),
            endpoint,
        })
    }
}

pub struct UpdaterState {
    settings: Option<Settings>,
    pending: Mutex<Option<(Update, Instant)>>,
    busy: AtomicBool,
}

impl UpdaterState {
    pub fn new(settings: Option<Settings>) -> Self {
        Self {
            settings,
            pending: Mutex::new(None),
            busy: AtomicBool::new(false),
        }
    }

    fn begin(&self) -> Result<Operation<'_>, &'static str> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "update_busy")?;
        Ok(Operation(&self.busy))
    }
}

struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    state: &'static str,
    version: Option<String>,
}

fn secure_url(value: &str) -> Result<Url, &'static str> {
    if value.len() > 2048 {
        return Err("update_configuration_invalid");
    }
    let url = Url::parse(value).map_err(|_| "update_configuration_invalid")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("update_configuration_invalid");
    }
    Ok(url)
}

fn public_version(version: &str) -> Result<String, &'static str> {
    if version.is_empty()
        || version.len() > 96
        || !version
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || b".-+".contains(&ch))
    {
        return Err("update_metadata_invalid");
    }
    Ok(version.to_owned())
}

async fn fetch(url: Url, limit: usize, timeout: Duration) -> Result<Vec<u8>, &'static str> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = updater_http::Client::builder()
        .https_only(true)
        .redirect(updater_http::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5
                || attempt.url().scheme() != "https"
                || !attempt.url().username().is_empty()
                || attempt.url().password().is_some()
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .timeout(timeout)
        .build()
        .map_err(|_| "update_network_failed")?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "update_network_failed")?
        .error_for_status()
        .map_err(|_| "update_network_failed")?;
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err("update_size_exceeded");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "update_network_failed")?
    {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err("update_size_exceeded");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn check_updates(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdaterState>,
) -> Result<UpdateInfo, &'static str> {
    let _operation = state.begin()?;
    let Some(settings) = state.settings.as_ref() else {
        return Ok(UpdateInfo {
            state: "notConfigured",
            version: None,
        });
    };
    *state.pending.lock().map_err(|_| "update_state_failed")? = None;
    let bytes = fetch(
        settings.endpoint.clone(),
        METADATA_LIMIT,
        Duration::from_secs(20),
    )
    .await?;
    let metadata = serde_json::from_slice(&bytes).map_err(|_| "update_metadata_invalid")?;
    let updater = app
        .updater_builder()
        .pubkey(&settings.key)
        .endpoints(vec![settings.endpoint.clone()])
        .map_err(|_| "update_configuration_invalid")?
        .build()
        .map_err(|_| "update_configuration_invalid")?;
    // restore_update enforces signed-version binding and the SDK's newer-version policy.
    let Some(update) = updater
        .restore_update(metadata)
        .map_err(|_| "update_metadata_invalid")?
    else {
        return Ok(UpdateInfo {
            state: "upToDate",
            version: None,
        });
    };
    secure_url(update.download_url.as_str())?;
    let version = public_version(&update.version)?;
    *state.pending.lock().map_err(|_| "update_state_failed")? = Some((update, Instant::now()));
    Ok(UpdateInfo {
        state: "available",
        version: Some(version),
    })
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdaterState>,
    engine: tauri::State<'_, Engine>,
    authorization: tauri::State<'_, crate::authorization::Authorization>,
    confirmed: bool,
) -> Result<(), &'static str> {
    if !confirmed {
        return Err("update_confirmation_required");
    }
    let _operation = state.begin()?;
    let (update, checked) = state
        .pending
        .lock()
        .map_err(|_| "update_state_failed")?
        .take()
        .ok_or("update_check_required")?;
    if checked.elapsed() > PENDING_LIFETIME {
        return Err("update_check_required");
    }
    let bytes = fetch(
        secure_url(update.download_url.as_str())?,
        PACKAGE_LIMIT,
        Duration::from_secs(300),
    )
    .await?;
    update
        .verify(&bytes)
        .map_err(|_| "update_signature_invalid")?;
    // A new publisher cannot start between this awaited cleanup and installer launch.
    authorization.invalidate();
    engine.stop_for_update().await?;
    let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
    match installed {
        Ok(Ok(())) => {
            app.restart();
        }
        _ => {
            engine.finish_update();
            Err("update_install_failed")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_requires_a_real_key_and_credential_free_https() {
        let key = STANDARD.encode("untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3");
        assert!(Settings::parse(Some(&key), Some("https://example.org/latest.json")).is_some());
        for endpoint in [
            "http://example.org/a",
            "https://user:secret@example.org/a",
            "https://example.org/#key",
        ] {
            assert!(Settings::parse(Some(&key), Some(endpoint)).is_none());
        }
        assert!(Settings::parse(None, Some("https://example.org")).is_none());
        assert!(Settings::parse(Some("placeholder"), Some("https://example.org")).is_none());
    }

    #[test]
    fn operation_guard_prevents_overlapping_check_and_install_and_releases() {
        let state = UpdaterState::new(None);
        let operation = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(operation);
        assert!(state.begin().is_ok());
    }

    #[test]
    fn version_metadata_is_bounded_plain_text() {
        assert_eq!(
            public_version("1.2.3-rc.1+build").unwrap(),
            "1.2.3-rc.1+build"
        );
        for value in ["", "<img src=x>", "1.0\nInjected"] {
            assert!(public_version(value).is_err());
        }
        assert!(public_version(&"a".repeat(97)).is_err());
    }
}
