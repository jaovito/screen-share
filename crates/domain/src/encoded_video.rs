use crate::VideoProfile;

/// Bounds one encoded access unit, independently of any upstream queue.
pub const MAX_ACCESS_UNIT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodedVideoError {
    InvalidProfile,
    InvalidTimestamp,
    InvalidAnnexB,
    MissingPicture,
    MissingParameterSets,
    Oversized,
}

/// One encoder-delimited H.264 access unit. This validates transport framing,
/// not the H.264 bitstream's semantic correctness or decoder compatibility.
/// Payloads deliberately have no Debug/serialization implementation.
pub struct EncodedAccessUnit {
    payload: Vec<u8>,
    profile: VideoProfile,
    timestamp_us: i64,
    keyframe: bool,
}

impl EncodedAccessUnit {
    pub fn h264(
        payload: Vec<u8>,
        profile: VideoProfile,
        timestamp_us: i64,
    ) -> Result<Self, EncodedVideoError> {
        if VideoProfile::new(profile.height, profile.fps) != Ok(profile) {
            return Err(EncodedVideoError::InvalidProfile);
        }
        if timestamp_us < 0 {
            return Err(EncodedVideoError::InvalidTimestamp);
        }
        if payload.len() > MAX_ACCESS_UNIT_BYTES {
            return Err(EncodedVideoError::Oversized);
        }

        let mut cursor = 0;
        let mut picture = false;
        let mut keyframe = false;
        let mut sps = false;
        let mut pps = false;
        while cursor < payload.len() {
            let prefix = start_code(&payload, cursor).ok_or(EncodedVideoError::InvalidAnnexB)?;
            let header_at = cursor + prefix;
            let header = *payload
                .get(header_at)
                .ok_or(EncodedVideoError::InvalidAnnexB)?;
            let nal_type = header & 0x1f;
            if header & 0x80 != 0 || !(1..=23).contains(&nal_type) {
                return Err(EncodedVideoError::InvalidAnnexB);
            }
            let next = (header_at + 1..payload.len())
                .find(|index| start_code(&payload, *index).is_some())
                .unwrap_or(payload.len());
            if next <= header_at + 1 {
                return Err(EncodedVideoError::InvalidAnnexB);
            }
            match nal_type {
                1..=4 => picture = true,
                5 => {
                    if !sps || !pps {
                        return Err(EncodedVideoError::MissingParameterSets);
                    }
                    keyframe = true;
                    picture = true;
                }
                7 => sps = true,
                8 => pps = true,
                _ => {}
            }
            cursor = next;
        }
        if !picture {
            return Err(EncodedVideoError::MissingPicture);
        }

        Ok(Self {
            payload,
            profile,
            timestamp_us,
            keyframe,
        })
    }

    /// Preserve one publication clock across native encoder restarts without
    /// copying the encoded payload or replacing its capture-derived cadence.
    pub fn offset_timestamp_us(mut self, offset_us: i64) -> Result<Self, EncodedVideoError> {
        if offset_us < 0 {
            return Err(EncodedVideoError::InvalidTimestamp);
        }
        self.timestamp_us = self
            .timestamp_us
            .checked_add(offset_us)
            .ok_or(EncodedVideoError::InvalidTimestamp)?;
        Ok(self)
    }

    pub fn payload(&self) -> &[u8] {
        &self.payload
    }
    pub fn profile(&self) -> VideoProfile {
        self.profile
    }
    pub fn timestamp_us(&self) -> i64 {
        self.timestamp_us
    }
    pub fn is_keyframe(&self) -> bool {
        self.keyframe
    }
}

fn start_code(bytes: &[u8], offset: usize) -> Option<usize> {
    if bytes.get(offset..offset + 4) == Some(&[0, 0, 0, 1]) {
        Some(4)
    } else if bytes.get(offset..offset + 3) == Some(&[0, 0, 1]) {
        Some(3)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> VideoProfile {
        VideoProfile::new(1080, 60).expect("catalog profile")
    }
    fn keyframe() -> Vec<u8> {
        vec![0, 0, 0, 1, 0x67, 42, 0, 0, 1, 0x68, 42, 0, 0, 1, 0x65, 42]
    }

    #[test]
    fn preserves_encoder_payload_and_detects_idr_with_parameter_sets() {
        let payload = keyframe();
        let unit =
            EncodedAccessUnit::h264(payload.clone(), profile(), 100).expect("framed keyframe");
        assert_eq!(unit.payload(), payload);
        assert_eq!(unit.profile(), profile());
        assert_eq!(unit.timestamp_us(), 100);
        assert!(unit.is_keyframe());
        assert!(
            !EncodedAccessUnit::h264(vec![0, 0, 1, 0x41, 42], profile(), 101)
                .expect("delta picture")
                .is_keyframe()
        );
    }

    #[test]
    fn publication_timestamp_offset_preserves_payload_and_rejects_overflow() {
        let unit = EncodedAccessUnit::h264(keyframe(), profile(), 100)
            .expect("valid unit")
            .offset_timestamp_us(500)
            .expect("monotonic offset");
        assert_eq!(unit.timestamp_us(), 600);
        assert_eq!(unit.payload(), keyframe());
        assert!(
            EncodedAccessUnit::h264(keyframe(), profile(), 100)
                .expect("valid unit")
                .offset_timestamp_us(-1)
                .is_err()
        );
        assert!(
            EncodedAccessUnit::h264(keyframe(), profile(), 100)
                .expect("valid unit")
                .offset_timestamp_us(i64::MAX)
                .is_err()
        );
    }

    #[test]
    fn rejects_missing_sps_pps_missing_picture_and_bad_annex_b() {
        for payload in [
            vec![0, 0, 1, 0x65, 42],
            vec![0, 0, 1, 0x67, 42, 0, 0, 1, 0x65, 42],
        ] {
            assert!(matches!(
                EncodedAccessUnit::h264(payload, profile(), 0),
                Err(EncodedVideoError::MissingParameterSets)
            ));
        }
        assert!(matches!(
            EncodedAccessUnit::h264(vec![0, 0, 1, 0x67, 42], profile(), 0),
            Err(EncodedVideoError::MissingPicture)
        ));
        for payload in [
            vec![],
            vec![0x41, 42],
            vec![0, 0, 1],
            vec![0, 0, 1, 0x81, 42],
            vec![0, 0, 1, 0x18, 42],
            vec![0, 0, 1, 0x41, 0, 0, 1, 0x41, 42],
        ] {
            assert!(EncodedAccessUnit::h264(payload, profile(), 0).is_err());
        }
    }

    #[test]
    fn rejects_oversized_units_negative_timestamps_and_mutated_profiles() {
        assert!(matches!(
            EncodedAccessUnit::h264(vec![1; MAX_ACCESS_UNIT_BYTES + 1], profile(), 0),
            Err(EncodedVideoError::Oversized)
        ));
        assert!(matches!(
            EncodedAccessUnit::h264(keyframe(), profile(), -1),
            Err(EncodedVideoError::InvalidTimestamp)
        ));
        let invalid = VideoProfile {
            width: 1,
            ..profile()
        };
        assert!(matches!(
            EncodedAccessUnit::h264(keyframe(), invalid, 0),
            Err(EncodedVideoError::InvalidProfile)
        ));
    }
}
