use serde::Serialize;
use ss_application::Client;
use ss_domain::MediaState;
use ss_media_windows::WindowsCapture;
use ss_rtc_livekit::LiveKitTransport;
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
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_app_info])
        .run(tauri::generate_context!())
        .expect("Falha ao iniciar shell desktop");
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
