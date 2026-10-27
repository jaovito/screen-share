use super::{NativePublisher, NativeTransportError};
use livekit::{
    e2ee::EncryptionType,
    options::{AudioEncoding, TrackPublishOptions},
    prelude::{LocalAudioTrack, LocalTrack, TrackSource},
    webrtc::{
        audio_frame::AudioFrame,
        audio_source::{AudioSourceOptions, RtcAudioSource, native::NativeAudioSource},
    },
};
use std::{borrow::Cow, time::Duration};
use tokio::time::timeout;

pub(super) struct AudioPublication {
    pub(super) source: NativeAudioSource,
    pub(super) track: LocalAudioTrack,
}

impl NativePublisher {
    /// Call only after explicit audio consent and OS source preparation. A grant
    /// allowing audio is not itself consent to capture the complete system mix.
    pub async fn enable_audio(&mut self) -> Result<(), NativeTransportError> {
        self.ensure_live()?;
        if !self.audio_allowed {
            return Err(NativeTransportError::PermissionDenied);
        }
        if self.audio.is_some() {
            return Ok(());
        }
        let source = NativeAudioSource::new(AudioSourceOptions::default(), 48000, 2, 20);
        let track = LocalAudioTrack::create_audio_track(
            "system-audio",
            RtcAudioSource::Native(source.clone()),
        );
        let options = TrackPublishOptions {
            source: TrackSource::ScreenshareAudio,
            audio_encoding: Some(AudioEncoding {
                max_bitrate: 128000,
            }),
            dtx: true,
            ..Default::default()
        };
        let publication = timeout(
            Duration::from_secs(5),
            self.room
                .local_participant()
                .publish_track(LocalTrack::Audio(track.clone()), options),
        )
        .await;
        if !matches!(publication, Ok(Ok(ref publication)) if publication.encryption_type() == EncryptionType::Gcm)
        {
            self.fail(NativeTransportError::PublicationFailed);
            return Err(NativeTransportError::PublicationFailed);
        }
        self.audio = Some(AudioPublication { source, track });
        self.ensure_live()?;
        self.set_paused(self.paused)
    }

    /// One native PCM packet, 48 kHz stereo, at most 100 ms. No data channel,
    /// HTTP/IPC payload or extra application queue carries these samples.
    pub async fn push_audio(&mut self, samples: &[i16]) -> Result<(), NativeTransportError> {
        self.ensure_live()?;
        if self.paused {
            return Err(NativeTransportError::Paused);
        }
        if samples.is_empty() || !samples.len().is_multiple_of(2) || samples.len() > 9600 {
            return Err(NativeTransportError::InvalidFrame);
        }
        let audio = self
            .audio
            .as_ref()
            .ok_or(NativeTransportError::PermissionDenied)?;
        let frame = AudioFrame {
            data: Cow::Borrowed(samples),
            sample_rate: 48000,
            num_channels: 2,
            samples_per_channel: (samples.len() / 2) as u32,
        };
        let result = timeout(
            Duration::from_millis(100),
            audio.source.capture_frame(&frame),
        )
        .await;
        if !matches!(result, Ok(Ok(()))) {
            self.fail(NativeTransportError::FrameRejected);
            return Err(NativeTransportError::FrameRejected);
        }
        self.ensure_live()
    }
}
