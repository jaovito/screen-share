mod encoded_video;
mod quality;

pub use quality::{AdaptiveQuality, QualityMode, QualityReason, QualityUpdate};

pub use encoded_video::{EncodedAccessUnit, EncodedVideoError, MAX_ACCESS_UNIT_BYTES};

mod session;

pub use session::{
    CaptureKind, CaptureSelection, PauseReason, SessionError, SessionLease, SharingState,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoProfile {
    pub width: u16,
    pub height: u16,
    pub fps: u8,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaError {
    InvalidProfile,
    NotImplemented,
    UnsupportedPlatform,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaState {
    NotImplemented,
    UnsupportedPlatform,
}
impl VideoProfile {
    pub fn new(height: u16, fps: u8) -> Result<Self, MediaError> {
        let width = match height {
            480 => 854,
            720 => 1280,
            1080 => 1920,
            1440 => 2560,
            _ => return Err(MediaError::InvalidProfile),
        };
        if fps != 30 && fps != 60 {
            return Err(MediaError::InvalidProfile);
        }
        Ok(Self { width, height, fps })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_catalog_profiles() {
        for height in [480, 720, 1080, 1440] {
            for fps in [30, 60] {
                assert!(VideoProfile::new(height, fps).is_ok());
            }
        }
        assert_eq!(VideoProfile::new(1440, 60).map(|p| p.width), Ok(2560));
        assert_eq!(VideoProfile::new(1080, 45), Err(MediaError::InvalidProfile));
        assert_eq!(VideoProfile::new(2160, 60), Err(MediaError::InvalidProfile));
    }
}
