//! Explicitly enabled M1 transport experiment, not a complete publisher or hardware proof.

mod adaptation;
mod audio;
mod config;
mod renewal;
mod supervisor;

pub use config::{MediaKey, PublisherGrant};

use livekit::{
    ConnectionState, Room, RoomOptions,
    e2ee::{
        E2eeOptions, EncryptionType,
        key_provider::{KeyProvider, KeyProviderOptions},
    },
    options::{TrackPublishOptions, VideoCodec, VideoEncoderBackend, VideoEncoding},
    prelude::{LocalTrack, LocalVideoTrack, TrackSource},
    webrtc::{
        video_frame::{EncodedFrameType, EncodedVideoCodec, EncodedVideoFrame},
        video_source::{RtcVideoSource, VideoResolution, native::NativeVideoSource},
    },
};
use ss_domain::{EncodedAccessUnit, VideoProfile};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use supervisor::{Gate, close_room, join_shutdown, stop, supervise};
use tokio::{sync::Notify, task::JoinHandle, time::timeout};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeTransportError {
    InvalidGrant,
    InvalidKey,
    InvalidProfile,
    InvalidBitrate,
    InvalidFrame,
    ConnectionFailed,
    ConnectionTimedOut,
    PermissionDenied,
    EncryptionUnavailable,
    PublicationFailed,
    UnexpectedMedia,
    KeyframeRequired,
    FrameRejected,
    Expired,
    Disconnected,
    ReconnectRequired,
    Stopped,
    Paused,
    CloseFailed,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EncoderFeedback {
    pub request_keyframe: bool,
    pub target_bitrate_bps: Option<u64>,
    pub target_fps: Option<f64>,
}

/// No media queue is introduced here. The caller owns a bounded encoder pipeline.
/// Credential/key/source handles deliberately have no Debug/Serialize implementation.
pub struct NativePublisher {
    binding: config::GrantBinding,
    media_key: Vec<u8>,
    max_bitrate_bps: u32,
    track: LocalVideoTrack,
    paused: bool,
    audio: Option<audio::AudioPublication>,
    audio_allowed: bool,
    room: Arc<Room>,
    source: NativeVideoSource,
    profile: VideoProfile,
    profile_ceiling: VideoProfile,
    deadline: Instant,
    gate: Gate,
    wake: Arc<Notify>,
    supervisor: Option<JoinHandle<Result<(), NativeTransportError>>>,
    cleanup_result: Option<Result<(), NativeTransportError>>,
    last_timestamp: Option<i64>,
    needs_keyframe: bool,
}

impl NativePublisher {
    /// The caller must filter credential-bearing SDK diagnostics at its logging
    /// boundary. This library never installs a logger or disables application audits.
    pub async fn connect(
        grant: PublisherGrant,
        media_key: MediaKey,
        profile: VideoProfile,
        max_bitrate_bps: u32,
    ) -> Result<Self, NativeTransportError> {
        if VideoProfile::new(profile.height, profile.fps) != Ok(profile) {
            return Err(NativeTransportError::InvalidProfile);
        }
        if !(64_000..=50_000_000).contains(&max_bitrate_bps) {
            return Err(NativeTransportError::InvalidBitrate);
        }
        if Instant::now() >= grant.deadline {
            return Err(NativeTransportError::Expired);
        }

        let key_provider =
            KeyProvider::with_shared_key(KeyProviderOptions::default(), media_key.0.clone());
        let mut options = RoomOptions::default();
        options.auto_subscribe = false;
        options.adaptive_stream = false;
        options.dynacast = false;
        options.join_retries = 0;
        options.connect_timeout = Duration::from_secs(10);
        options.encryption = Some(E2eeOptions {
            encryption_type: EncryptionType::Gcm,
            key_provider,
        });
        let (room, events) = timeout(
            grant
                .deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_secs(15)),
            Room::connect(&grant.server_url, &grant.access_token, options),
        )
        .await
        .map_err(|_| NativeTransportError::ConnectionTimedOut)?
        .map_err(|_| NativeTransportError::ConnectionFailed)?;
        let room = Arc::new(room);
        let gate = Arc::new(Mutex::new(None));
        let wake = Arc::new(Notify::new());
        let supervisor = supervise(
            room.clone(),
            events,
            gate.clone(),
            wake.clone(),
            grant.deadline,
        );

        let accepted = room.name() == grant.room
            && room.local_participant().identity().to_string() == grant.identity
            && permission_matches(&room, grant.audio_allowed)
            && room.e2ee_manager().enabled()
            && room.e2ee_manager().encryption_type() == EncryptionType::Gcm;
        if !accepted {
            stop(&gate, NativeTransportError::PermissionDenied);
            wake.notify_one();
            let _ = close_room(&room).await;
            return Err(NativeTransportError::PermissionDenied);
        }

        let resolution = VideoResolution {
            width: profile.width.into(),
            height: profile.height.into(),
        };
        let source = NativeVideoSource::new_encoded(resolution);
        let track =
            LocalVideoTrack::create_video_track("screen", RtcVideoSource::Native(source.clone()));
        let publish_options = TrackPublishOptions {
            video_codec: VideoCodec::H264,
            video_encoder: VideoEncoderBackend::PreEncoded,
            video_encoding: Some(VideoEncoding {
                max_bitrate: max_bitrate_bps.into(),
                max_framerate: profile.fps.into(),
            }),
            simulcast: false,
            source: TrackSource::Screenshare,
            ..Default::default()
        };
        let publication = timeout(
            Duration::from_secs(10),
            room.local_participant()
                .publish_track(LocalTrack::Video(track.clone()), publish_options),
        )
        .await;
        let published = match publication {
            Ok(Ok(publication)) => publication.encryption_type() == EncryptionType::Gcm,
            _ => false,
        };
        if !published {
            stop(&gate, NativeTransportError::PublicationFailed);
            wake.notify_one();
            let _ = close_room(&room).await;
            return Err(NativeTransportError::PublicationFailed);
        }

        let publisher = Self {
            binding: grant.binding(),
            media_key: media_key.0,
            max_bitrate_bps,
            track,
            paused: false,
            audio: None,
            audio_allowed: grant.audio_allowed,
            room,
            source,
            profile,
            profile_ceiling: profile,
            deadline: grant.deadline,
            gate,
            wake,
            supervisor: Some(supervisor),
            cleanup_result: None,
            last_timestamp: None,
            needs_keyframe: true,
        };
        publisher.ensure_live()?;
        Ok(publisher)
    }

    pub fn feedback(&mut self) -> Result<EncoderFeedback, NativeTransportError> {
        self.ensure_live()?;
        self.needs_keyframe |= self.source.take_keyframe_request();
        let target = self.source.take_rate_control_request();
        Ok(EncoderFeedback {
            request_keyframe: self.needs_keyframe,
            target_bitrate_bps: target.map(|target| target.target_bitrate_bps),
            target_fps: target.map(|target| target.framerate_fps),
        })
    }

    pub fn push(
        &mut self,
        unit: &EncodedAccessUnit,
    ) -> Result<EncoderFeedback, NativeTransportError> {
        self.ensure_live()?;
        if self.paused {
            return Err(NativeTransportError::Paused);
        }
        if unit.profile() != self.profile
            || self
                .last_timestamp
                .is_some_and(|last| unit.timestamp_us() <= last)
            || unit.timestamp_us() == i64::MAX
        {
            self.fail(NativeTransportError::InvalidFrame);
            return Err(NativeTransportError::InvalidFrame);
        }
        self.needs_keyframe |= self.source.take_keyframe_request();
        if self.needs_keyframe && !unit.is_keyframe() {
            return Err(NativeTransportError::KeyframeRequired);
        }

        let frame = EncodedVideoFrame {
            codec: EncodedVideoCodec::H264,
            payload: unit.payload(),
            // SDK timestamp zero is a wall-clock sentinel. Offset every timestamp
            // equally so a zero-based producer keeps its monotonic capture clock.
            timestamp_us: unit.timestamp_us() + 1,
            frame_type: if unit.is_keyframe() {
                EncodedFrameType::Key
            } else {
                EncodedFrameType::Delta
            },
            resolution: VideoResolution {
                width: self.profile.width.into(),
                height: self.profile.height.into(),
            },
            frame_metadata: None,
        };
        let accepted = {
            let stopped = self
                .gate
                .lock()
                .map_err(|_| NativeTransportError::Stopped)?;
            if let Some(reason) = *stopped {
                return Err(reason);
            }
            self.source.capture_encoded_frame(&frame)
        };
        self.last_timestamp = Some(unit.timestamp_us());
        if !accepted {
            self.needs_keyframe = true;
            return Err(NativeTransportError::FrameRejected);
        }
        if unit.is_keyframe() {
            self.needs_keyframe = false;
        }
        self.feedback()
    }

    pub async fn close(&mut self) -> Result<(), NativeTransportError> {
        self.fail(NativeTransportError::Stopped);
        join_shutdown(
            &mut self.supervisor,
            &mut self.cleanup_result,
            Duration::from_secs(4),
        )
        .await
    }

    fn fail(&self, reason: NativeTransportError) {
        stop(&self.gate, reason);
        self.wake.notify_one();
    }

    fn ensure_live(&self) -> Result<(), NativeTransportError> {
        let stopped = self
            .gate
            .lock()
            .map_err(|_| NativeTransportError::Stopped)?;
        if let Some(reason) = *stopped {
            return Err(reason);
        }
        drop(stopped);
        let reason = if Instant::now() >= self.deadline {
            Some(NativeTransportError::Expired)
        } else if self.room.connection_state() != ConnectionState::Connected {
            Some(NativeTransportError::Disconnected)
        } else if !permission_matches(&self.room, self.audio_allowed) {
            Some(NativeTransportError::PermissionDenied)
        } else if !self.room.e2ee_manager().enabled() {
            Some(NativeTransportError::EncryptionUnavailable)
        } else {
            None
        };
        if let Some(reason) = reason {
            self.fail(reason);
            return Err(reason);
        }
        Ok(())
    }
}

impl Drop for NativePublisher {
    fn drop(&mut self) {
        self.fail(NativeTransportError::Stopped);
    }
}

fn permission_matches(room: &Room, audio_allowed: bool) -> bool {
    room.local_participant()
        .permission()
        .is_some_and(|permission| {
            // LiveKit's acknowledged protocol TrackSource.SCREEN_SHARE is 3.
            permission.can_publish
                && !permission.can_subscribe
                && !permission.can_publish_data
                && publication_sources_match(&permission.can_publish_sources, audio_allowed)
        })
}

fn publication_sources_match(sources: &[i32], audio_allowed: bool) -> bool {
    if audio_allowed {
        sources.len() == 2 && sources.contains(&3) && sources.contains(&4)
    } else {
        sources == [3]
    }
}

#[cfg(test)]
mod bitrate_tests {
    use super::*;

    #[test]
    fn acknowledged_source_scope_is_an_exact_set_independent_of_order() {
        assert!(publication_sources_match(&[3, 4], true));
        assert!(publication_sources_match(&[4, 3], true));
        assert!(publication_sources_match(&[3], false));
        for sources in [&[][..], &[3][..], &[3, 3][..], &[3, 4, 2][..], &[1, 4][..]] {
            assert!(!publication_sources_match(sources, true));
        }
        assert!(!publication_sources_match(&[3, 4], false));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn rejects_invalid_operator_bitrate_before_sdk_connection() {
        for bitrate in [0, 63_999, 50_000_001, u32::MAX] {
            let grant = PublisherGrant {
                session_id: "synthetic-session".into(),
                epoch: 1,
                room: "synthetic-room".into(),
                identity: "synthetic-identity".into(),
                server_url: "ws://127.0.0.1:1".into(),
                access_token: "not-a-usable-token".into(),
                deadline: Instant::now() + Duration::from_secs(60),
                audio_allowed: false,
            };
            let key =
                MediaKey::from_encoded_secret(&"a".repeat(43)).expect("synthetic independent key");
            let result = NativePublisher::connect(
                grant,
                key,
                VideoProfile::new(1080, 60).expect("catalog profile"),
                bitrate,
            )
            .await;
            assert!(matches!(result, Err(NativeTransportError::InvalidBitrate)));
        }
    }
}
