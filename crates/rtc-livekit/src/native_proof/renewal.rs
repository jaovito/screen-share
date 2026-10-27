use super::{MediaKey, NativePublisher, NativeTransportError, PublisherGrant};
use ss_domain::VideoProfile;
use std::time::Instant;

impl NativePublisher {
    /// A lease is never extended from decoded JWT claims alone. Close the old
    /// publication and have the SFU authenticate the replacement signed grant.
    /// The caller keeps its original capture item and bounded native frame slot.
    pub async fn renew(&mut self, grant: PublisherGrant) -> Result<(), NativeTransportError> {
        let ceiling = self.profile_ceiling;
        let current = self.profile;
        self.renew_with_profile(grant, ceiling, self.max_bitrate_bps)
            .await?;
        self.reconfigure_profile(current)?;
        Ok(())
    }

    /// Explicit profile changes also reauthenticate; they do not switch source.
    pub async fn renew_with_profile(
        &mut self,
        grant: PublisherGrant,
        profile: VideoProfile,
        bitrate_bps: u32,
    ) -> Result<(), NativeTransportError> {
        self.ensure_live()?;
        validate_renewal(&self.binding, self.audio_allowed, &grant, Instant::now())?;
        if VideoProfile::new(profile.height, profile.fps) != Ok(profile) {
            return Err(NativeTransportError::InvalidProfile);
        }
        if !(64_000..=50_000_000).contains(&bitrate_bps) {
            return Err(NativeTransportError::InvalidBitrate);
        }

        let key = MediaKey(self.media_key.clone());
        let paused = self.paused;
        let audio_enabled = self.audio.is_some();
        self.close().await?;
        let mut replacement = Self::connect(grant, key, profile, bitrate_bps).await?;
        if audio_enabled {
            replacement.enable_audio().await?;
        }
        replacement.set_paused(paused)?;
        *self = replacement;
        Ok(())
    }

    /// Muting is visible to receivers and prevents newly submitted media while
    /// paused. Resume starts with an independently decodable keyframe.
    pub fn set_paused(&mut self, paused: bool) -> Result<(), NativeTransportError> {
        self.ensure_live()?;
        if paused {
            self.track.mute();
        } else {
            self.needs_keyframe = true;
            self.track.unmute();
        }
        if let Some(audio) = &self.audio {
            audio.source.clear_buffer();
            if paused {
                audio.track.mute();
            } else {
                audio.track.unmute();
            }
        }
        self.paused = paused;
        Ok(())
    }
}

fn same_lease_binding(
    previous: &super::config::GrantBinding,
    next: &super::config::GrantBinding,
) -> bool {
    previous == next
}

fn validate_renewal(
    binding: &super::config::GrantBinding,
    audio_allowed: bool,
    grant: &PublisherGrant,
    now: Instant,
) -> Result<(), NativeTransportError> {
    if !same_lease_binding(binding, &grant.binding()) || audio_allowed != grant.audio_allowed {
        return Err(NativeTransportError::InvalidGrant);
    }
    if grant.deadline <= now {
        return Err(NativeTransportError::Expired);
    }
    // Equal/shorter valid leases are safe: every replacement closes the old
    // connection and asks the SFU to authenticate the supplied signed token.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn binding(session: &str, epoch: u64, room: &str, identity: &str, server: &str) -> Value {
        json!({"session": session, "epoch": epoch, "room": room, "identity": identity, "server": server})
    }

    #[test]
    fn renewed_grants_cannot_change_session_epoch_room_identity_or_server() {
        let value = binding("session", 2, "ss-room", "owner", "wss://rtc.example");
        let make = |candidate: &Value| {
            super::super::config::GrantBinding::from_test_parts(
                candidate["session"].as_str().unwrap(),
                candidate["epoch"].as_u64().unwrap(),
                candidate["room"].as_str().unwrap(),
                candidate["identity"].as_str().unwrap(),
                candidate["server"].as_str().unwrap(),
            )
        };
        let original = make(&value);
        assert!(same_lease_binding(&original, &make(&value)));
        for (field, replacement) in [
            ("session", json!("other")),
            ("epoch", json!(1)),
            ("epoch", json!(3)),
            ("room", json!("other")),
            ("identity", json!("other")),
            ("server", json!("wss://other.example")),
        ] {
            let mut candidate = value.clone();
            candidate[field] = replacement;
            assert!(!same_lease_binding(&original, &make(&candidate)));
        }
    }

    #[test]
    fn fresh_authenticated_replacements_may_have_equal_or_shorter_valid_deadlines() {
        let now = Instant::now();
        let mut grant = PublisherGrant {
            session_id: "session".into(),
            epoch: 2,
            room: "ss-room".into(),
            identity: "owner".into(),
            server_url: "wss://rtc.example".into(),
            access_token: "synthetic-not-used".into(),
            deadline: now + std::time::Duration::from_secs(60),
            audio_allowed: false,
        };
        let previous = grant.binding();
        assert_eq!(validate_renewal(&previous, false, &grant, now), Ok(()));
        grant.deadline = now + std::time::Duration::from_secs(1);
        assert_eq!(validate_renewal(&previous, false, &grant, now), Ok(()));
        assert_eq!(
            validate_renewal(&previous, true, &grant, now),
            Err(NativeTransportError::InvalidGrant)
        );
        grant.deadline = now;
        assert_eq!(
            validate_renewal(&previous, false, &grant, now),
            Err(NativeTransportError::Expired)
        );
    }
}
