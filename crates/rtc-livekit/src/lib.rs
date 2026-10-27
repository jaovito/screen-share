use ss_application::RtcPort;
use ss_domain::MediaError;

#[cfg(all(
    feature = "native-proof",
    any(target_os = "windows", target_os = "macos")
))]
pub mod native_proof;

pub struct LiveKitTransport;
impl RtcPort for LiveKitTransport {
    fn prepare(&self) -> Result<(), MediaError> {
        #[cfg(target_os = "windows")]
        {
            Err(MediaError::NotImplemented)
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err(MediaError::UnsupportedPlatform)
        }
    }
}
