use ss_application::RtcPort;
use ss_domain::MediaError;
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
