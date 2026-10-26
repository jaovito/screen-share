use ss_domain::{MediaError, MediaState, VideoProfile};
pub trait CapturePort {
    fn prepare(&self, profile: VideoProfile) -> Result<(), MediaError>;
}
pub trait RtcPort {
    fn prepare(&self) -> Result<(), MediaError>;
}
pub struct Client<C, R> {
    capture: C,
    rtc: R,
}
impl<C: CapturePort, R: RtcPort> Client<C, R> {
    pub fn new(capture: C, rtc: R) -> Self {
        Self { capture, rtc }
    }
    /// Apenas verifica as fronteiras. Não abre fonte nem simula sessão.
    pub fn implementation_state(&self) -> MediaState {
        let result = VideoProfile::new(1080, 60)
            .and_then(|profile| self.capture.prepare(profile))
            .and_then(|()| self.rtc.prepare());
        match result {
            Err(MediaError::UnsupportedPlatform) => MediaState::UnsupportedPlatform,
            _ => MediaState::NotImplemented,
        }
    }
    pub fn prepare(&self, height: u16, fps: u8) -> Result<(), MediaError> {
        self.capture.prepare(VideoProfile::new(height, fps)?)?;
        self.rtc.prepare()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Unavailable;
    impl CapturePort for Unavailable {
        fn prepare(&self, _: VideoProfile) -> Result<(), MediaError> {
            Err(MediaError::NotImplemented)
        }
    }
    impl RtcPort for Unavailable {
        fn prepare(&self) -> Result<(), MediaError> {
            Err(MediaError::NotImplemented)
        }
    }
    #[test]
    fn fails_closed_and_validates_before_adapters() {
        let client = Client::new(Unavailable, Unavailable);
        assert_eq!(client.prepare(1080, 60), Err(MediaError::NotImplemented));
        assert_eq!(client.prepare(1080, 45), Err(MediaError::InvalidProfile));
        assert_eq!(client.implementation_state(), MediaState::NotImplemented);
    }
}
