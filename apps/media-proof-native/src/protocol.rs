use serde::{Deserialize, Serialize};
use std::io::{BufRead, Read, Write};
use zeroize::{Zeroize, Zeroizing};

pub const MAX_PACKET_BYTES: usize = 24 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GrantPacket {
    pub version: u8,
    pub session_id: String,
    pub epoch: u64,
    pub rtc_room: String,
    pub participant_id: String,
    pub publisher_id: String,
    pub role: String,
    pub server_url: String,
    pub access_token: String,
    pub expires_at: u64,
}

impl GrantPacket {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != 1
            || self.epoch == 0
            || self.epoch > 9_007_199_254_740_991
            || self.session_id.len() != 36
            || self.participant_id.len() != 36
            || self.publisher_id != self.participant_id
            || self.role != "publisher"
            || self.rtc_room.len() > 64
            || self.server_url.len() > 2048
            || self.access_token.is_empty()
            || self.access_token.len() > 12_000
            || self.expires_at == 0
        {
            return Err("invalid_grant");
        }
        Ok(())
    }

    pub fn private_json(&self) -> Result<Zeroizing<String>, &'static str> {
        self.validate()?;
        serde_json::to_string(self)
            .map(Zeroizing::new)
            .map_err(|_| "invalid_grant")
    }
}

impl Drop for GrantPacket {
    fn drop(&mut self) {
        self.access_token.zeroize();
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioMode {
    #[default]
    Off,
    System,
    Process,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualityMode {
    #[default]
    Motion,
    Text,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    pub grant: GrantPacket,
    pub profile_id: String,
    pub bitrate_bps: u32,
    pub media_key: String,
    #[serde(default)]
    pub audio_mode: AudioMode,
    #[serde(default)]
    pub audio_process_id: Option<u32>,
    #[serde(default)]
    pub audio_process_created_at: Option<String>,
    #[serde(default)]
    pub quality_mode: QualityMode,
}

impl StartRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        self.grant.validate()?;
        validate_profile(&self.profile_id, self.bitrate_bps)?;
        self.audio_process()?;
        if self.media_key.len() != 43
            || !self
                .media_key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err("invalid_key");
        }
        Ok(())
    }

    pub fn audio_process(&self) -> Result<Option<(u32, u64)>, &'static str> {
        match (
            self.audio_mode,
            self.audio_process_id,
            &self.audio_process_created_at,
        ) {
            (AudioMode::Process, Some(pid), Some(created)) if pid > 0 => {
                if created.is_empty()
                    || created.len() > 20
                    || created.starts_with('0')
                    || !created.bytes().all(|byte| byte.is_ascii_digit())
                {
                    return Err("invalid_audio_process");
                }
                let created = created
                    .parse::<u64>()
                    .map_err(|_| "invalid_audio_process")?;
                if created == 0 {
                    return Err("invalid_audio_process");
                }
                Ok(Some((pid, created)))
            }
            (AudioMode::Off | AudioMode::System, None, None) => Ok(None),
            _ => Err("invalid_audio_process"),
        }
    }
}
impl Drop for StartRequest {
    fn drop(&mut self) {
        self.media_key.zeroize();
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenewRequest {
    pub grant: GrantPacket,
    pub profile_id: Option<String>,
    pub bitrate_bps: Option<u32>,
}

impl RenewRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        self.grant.validate()?;
        match (&self.profile_id, self.bitrate_bps) {
            (None, None) => Ok(()),
            (Some(profile), Some(bitrate)) => validate_profile(profile, bitrate),
            _ => Err("invalid_profile"),
        }
    }
}

pub fn validate_profile(profile: &str, bitrate: u32) -> Result<(), &'static str> {
    if ![
        "480p30", "480p60", "720p30", "720p60", "1080p30", "1080p60", "1440p30", "1440p60",
    ]
    .contains(&profile)
        || !(64_000..=50_000_000).contains(&bitrate)
    {
        return Err("invalid_profile");
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Start { request: StartRequest },
    Renew { request: RenewRequest },
    Pause {},
    Resume {},
    Stop {},
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SharingState {
    Idle,
    Selecting,
    Connecting,
    Sharing,
    Paused,
    Stopped,
    Failed,
    UnsupportedPlatform,
    EngineMissing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncryptionState {
    Pending,
    Configured,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SharingReason {
    InvalidRequest,
    SelectionCanceled,
    SourceClosed,
    AuthorizationFailed,
    CaptureFailed,
    EncoderFailed,
    TransportFailed,
    WorkerFailed,
    EngineMissing,
    ChildUnresponsive,
    StoppedByUser,
    LeaseExpired,
    UnsupportedPlatform,
    CleanupFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdaptationReason {
    NetworkPressure,
    NetworkHeadroom,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharingStatus {
    pub state: SharingState,
    pub profile_id: Option<String>,
    pub elapsed_ms: u64,
    pub frames_captured: u64,
    pub frames_encoded: u64,
    pub encoded_bytes: u64,
    pub queue_replacements: u64,
    pub capture_fps: Option<f64>,
    pub encoded_fps: Option<f64>,
    pub target_fps: Option<f64>,
    pub reason: Option<SharingReason>,
    pub encryption: EncryptionState,
    pub audio_supported: bool,
    pub audio_samples: u64,
    #[serde(default)]
    pub adaptation_reason: Option<AdaptationReason>,
    #[serde(default)]
    pub quality_changes: u64,
    #[serde(default)]
    pub target_bitrate_bps: Option<u32>,
    #[serde(default)]
    pub diagnostics_generation: u64,
    #[serde(default)]
    pub capture_recoveries: u64,
    #[serde(default)]
    pub diagnostics_elapsed_ms: u64,
    /// CPU time spent submitting conversion commands, not GPU execution time.
    #[serde(default)]
    pub conversion_submission_ms: Option<f64>,
    /// Accepted MF input to matching output: includes driver/GPU/MFT waiting.
    #[serde(default)]
    pub encoder_output_latency_ms: Option<f64>,
    #[serde(default)]
    pub available_send_bitrate_bps: Option<u64>,
    #[serde(default)]
    pub manual_bitrate_bps: Option<u32>,
}

impl SharingStatus {
    pub fn idle() -> Self {
        Self {
            state: SharingState::Idle,
            profile_id: None,
            elapsed_ms: 0,
            frames_captured: 0,
            frames_encoded: 0,
            encoded_bytes: 0,
            queue_replacements: 0,
            capture_fps: None,
            encoded_fps: None,
            target_fps: None,
            reason: None,
            encryption: EncryptionState::Pending,
            audio_supported: false,
            audio_samples: 0,
            adaptation_reason: None,
            quality_changes: 0,
            target_bitrate_bps: None,
            diagnostics_generation: 0,
            capture_recoveries: 0,
            diagnostics_elapsed_ms: 0,
            conversion_submission_ms: None,
            encoder_output_latency_ms: None,
            available_send_bitrate_bps: None,
            manual_bitrate_bps: None,
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.capture_recoveries > 3
            || self.diagnostics_generation > 9_007_199_254_740_991
            || self.diagnostics_elapsed_ms > 9_007_199_254_740_991
            || self
                .available_send_bitrate_bps
                .is_some_and(|value| value > 1_000_000_000_000)
            || self
                .manual_bitrate_bps
                .is_some_and(|value| !(64_000..=50_000_000).contains(&value))
            || [
                self.conversion_submission_ms,
                self.encoder_output_latency_ms,
            ]
            .into_iter()
            .flatten()
            .any(|value| !value.is_finite() || !(0.0..=60_000.0).contains(&value))
            || self
                .target_bitrate_bps
                .is_some_and(|bitrate| !(64_000..=50_000_000).contains(&bitrate))
            || self
                .profile_id
                .as_ref()
                .is_some_and(|profile| validate_profile(profile, 64_000).is_err())
            || [self.capture_fps, self.encoded_fps, self.target_fps]
                .into_iter()
                .flatten()
                .any(|value| !value.is_finite() || value < 0.0 || value > 10_000.0)
        {
            return Err("invalid_status");
        }
        Ok(())
    }
}

fn packet<R: BufRead>(reader: &mut R) -> Result<Option<Zeroizing<Vec<u8>>>, &'static str> {
    let mut bytes = Zeroizing::new(Vec::new());
    let read = (&mut *reader)
        .take(MAX_PACKET_BYTES as u64 + 1)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "pipe_read_failed")?;
    if read == 0 {
        return Ok(None);
    }
    if read > MAX_PACKET_BYTES || bytes.last() != Some(&b'\n') {
        return Err("invalid_packet");
    }
    Ok(Some(bytes))
}

pub fn read_command(reader: &mut impl BufRead) -> Result<Option<Command>, &'static str> {
    packet(reader)?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| "invalid_command"))
        .transpose()
}

pub fn read_status(reader: &mut impl BufRead) -> Result<Option<SharingStatus>, &'static str> {
    let status = packet(reader)?
        .map(|bytes| serde_json::from_slice::<SharingStatus>(&bytes).map_err(|_| "invalid_status"))
        .transpose()?;
    if let Some(status) = &status {
        status.validate()?;
    }
    Ok(status)
}

pub fn write_packet(writer: &mut impl Write, value: &impl Serialize) -> Result<(), &'static str> {
    let mut bytes = Zeroizing::new(serde_json::to_vec(value).map_err(|_| "invalid_packet")?);
    if bytes.len() >= MAX_PACKET_BYTES {
        return Err("invalid_packet");
    }
    bytes.push(b'\n');
    writer
        .write_all(&bytes)
        .and_then(|()| writer.flush())
        .map_err(|_| "pipe_write_failed")
}

#[cfg(test)]
mod tests;
