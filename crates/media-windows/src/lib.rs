#[cfg(all(target_os = "windows", feature = "probe-ui"))]
mod probe_window;

#[cfg(all(target_os = "windows", feature = "probe-ui"))]
pub use probe_window::{ProbeWindow, terminate_probe};

mod encoder_error;

pub use encoder_error::EncoderError;

#[cfg(target_os = "windows")]
mod encode;

#[cfg(target_os = "windows")]
pub use encode::{EncoderPoll, HardwareEncoder, SubmitOutcome};

#[cfg(all(test, not(target_os = "windows")))]
#[path = "encode/h264.rs"]
mod h264_framing_tests;

#[cfg(target_os = "windows")]
mod capture;

#[cfg(target_os = "windows")]
pub use capture::{
    CaptureError, CaptureReader, CaptureStatus, NativeCapture, NativeFrame, PickedSource,
    pick_source, supported,
};

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
