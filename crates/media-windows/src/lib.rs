use ss_application::CapturePort;
use ss_domain::{MediaError, VideoProfile};
pub struct WindowsCapture;
impl CapturePort for WindowsCapture {
    fn prepare(&self, _profile: VideoProfile) -> Result<(), MediaError> {
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
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_capture_with_typed_error() {
        let profile = VideoProfile::new(1080, 60).expect("valid catalog profile");
        #[cfg(target_os = "windows")]
        assert_eq!(
            WindowsCapture.prepare(profile),
            Err(MediaError::NotImplemented)
        );
        #[cfg(not(target_os = "windows"))]
        assert_eq!(
            WindowsCapture.prepare(profile),
            Err(MediaError::UnsupportedPlatform)
        );
    }
}
