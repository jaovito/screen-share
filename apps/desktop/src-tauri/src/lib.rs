mod audio_sources;
mod authorization;
mod engine;
mod updater;

use engine::Engine;
use serde::Serialize;
use ss_application::Client;
use ss_control_client::{ControlClient, ControlError, ControlRequest, ControlResponse};
use ss_domain::MediaState;
use ss_media_proof::protocol::{GrantPacket, SharingStatus, StartRequest};
use ss_media_windows::WindowsCapture;
use ss_rtc_livekit::LiveKitTransport;
use tauri::Manager;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: &'static str,
    platform: &'static str,
    media_status: &'static str,
}
#[tauri::command]
fn get_app_info() -> AppInfo {
    let state = Client::new(WindowsCapture, LiveKitTransport).implementation_state();
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        media_status: match state {
            MediaState::NotImplemented => "not_implemented",
            MediaState::UnsupportedPlatform => "unsupported_platform",
        },
    }
}

fn engine_binary(app: &tauri::AppHandle) -> Result<std::path::PathBuf, &'static str> {
    let directory = app.path().resource_dir().map_err(|_| "engine_missing")?;
    Ok(directory.join("ss-media-proof.exe"))
}

#[tauri::command]
async fn start_sharing(
    app: tauri::AppHandle,
    room_id: String,
    request: StartRequest,
) -> Result<SharingStatus, &'static str> {
    authorization::start(app, room_id, request).await
}

#[tauri::command]
fn stop_sharing(
    state: tauri::State<'_, Engine>,
    authorization: tauri::State<'_, authorization::Authorization>,
) -> Result<SharingStatus, &'static str> {
    authorization.stop(&state)
}

#[tauri::command]
fn pause_sharing(state: tauri::State<'_, Engine>) -> Result<SharingStatus, &'static str> {
    state.pause()
}

#[tauri::command]
fn resume_sharing(state: tauri::State<'_, Engine>) -> Result<SharingStatus, &'static str> {
    state.resume()
}

#[tauri::command]
async fn renew_sharing(
    app: tauri::AppHandle,
    grant: GrantPacket,
    profile_id: Option<String>,
    bitrate_bps: Option<u32>,
) -> Result<SharingStatus, &'static str> {
    authorization::renew(app, grant, profile_id, bitrate_bps).await
}

#[tauri::command]
fn get_sharing_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Engine>,
) -> Result<SharingStatus, &'static str> {
    let mut status = state.status()?;
    if cfg!(target_os = "windows")
        && status.state == ss_media_proof::protocol::SharingState::Idle
        && !engine_binary(&app)?.is_file()
    {
        status.state = ss_media_proof::protocol::SharingState::EngineMissing;
        status.reason = Some(ss_media_proof::protocol::SharingReason::EngineMissing);
        status.audio_supported = false;
    }
    Ok(status)
}

#[tauri::command]
async fn control_request(
    request: ControlRequest,
    client: tauri::State<'_, ControlClient>,
    engine: tauri::State<'_, Engine>,
    authorization: tauri::State<'_, authorization::Authorization>,
) -> Result<ControlResponse, ControlError> {
    let _suspension = if request.path == "/api/auth/sign-out" {
        Some(
            authorization
                .suspend(&engine)
                .map_err(|_| ControlError::Unavailable)?,
        )
    } else {
        None
    };
    client.request(request).await
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let client = ControlClient::new(
                option_env!("SCREEN_SHARE_API_URL").unwrap_or("http://127.0.0.1:3000"),
            )
            .map_err(|_| std::io::Error::other("Control transport configuration is invalid"))?;
            app.manage(client);
            app.manage(Engine::new());
            app.manage(authorization::Authorization::new());
            let settings = updater::Settings::parse(
                option_env!("SCREEN_SHARE_UPDATE_PUBLIC_KEY"),
                option_env!("SCREEN_SHARE_UPDATE_ENDPOINT"),
            );
            if settings.is_some() {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            app.manage(updater::UpdaterState::new(settings));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            audio_sources::list_audio_sources,
            start_sharing,
            stop_sharing,
            pause_sharing,
            resume_sharing,
            renew_sharing,
            get_sharing_status,
            control_request,
            updater::check_updates,
            updater::install_update
        ])
        .run(tauri::generate_context!())
        .expect("Desktop shell startup failed");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ipc_matches_transport_contract() {
        let info = get_app_info();
        let actual = serde_json::to_value(&info).expect("serializable DTO");
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/app-info.json"
        ))
        .expect("valid fixture");
        assert_eq!(
            actual.as_object().unwrap().keys().collect::<Vec<_>>(),
            fixture.as_object().unwrap().keys().collect::<Vec<_>>()
        );
        assert_eq!(actual["version"], fixture["version"]);
        assert_eq!(
            actual["mediaStatus"],
            if cfg!(target_os = "windows") {
                "not_implemented"
            } else {
                "unsupported_platform"
            }
        );
    }
}
