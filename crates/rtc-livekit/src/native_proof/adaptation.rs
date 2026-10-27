use super::{NativePublisher, NativeTransportError};
use ss_domain::VideoProfile;

impl NativePublisher {
    /// Reconfigures encoded-frame dimensions within the explicit user ceiling.
    /// The authenticated publication, source, encryption key and monotonic
    /// timestamp remain unchanged. The producer must rebuild its encoder and
    /// begin the new dimensions with an IDR including parameter sets.
    ///
    /// Pinned webrtc-sys forwards each buffer's dimensions to EncodedImage;
    /// this does not ask the SDK to resize already-encoded H.264 payloads.
    pub fn reconfigure_profile(
        &mut self,
        profile: VideoProfile,
    ) -> Result<(), NativeTransportError> {
        self.ensure_live()?;
        validate_profile(profile, self.profile_ceiling)?;
        if profile != self.profile {
            self.profile = profile;
            self.needs_keyframe = true;
        }
        Ok(())
    }
}

fn validate_profile(
    profile: VideoProfile,
    ceiling: VideoProfile,
) -> Result<(), NativeTransportError> {
    if VideoProfile::new(profile.height, profile.fps) != Ok(profile)
        || profile.height > ceiling.height
        || profile.fps > ceiling.fps
    {
        Err(NativeTransportError::InvalidProfile)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adaptive_dimensions_cannot_raise_the_authenticated_user_ceiling() {
        let ceiling = VideoProfile::new(1080, 30).unwrap();
        assert_eq!(
            validate_profile(VideoProfile::new(480, 30).unwrap(), ceiling),
            Ok(())
        );
        assert_eq!(validate_profile(ceiling, ceiling), Ok(()));
        for profile in [
            VideoProfile::new(1440, 30).unwrap(),
            VideoProfile::new(720, 60).unwrap(),
            VideoProfile {
                width: 42,
                height: 720,
                fps: 30,
            },
        ] {
            assert_eq!(
                validate_profile(profile, ceiling),
                Err(NativeTransportError::InvalidProfile)
            );
        }
    }
}
