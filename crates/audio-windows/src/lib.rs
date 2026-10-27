//! Explicit system/process-output audio. Never opens a microphone or widens scope.
#[cfg(target_os = "windows")]
mod process;
#[cfg(target_os = "windows")]
mod system;
#[cfg(target_os = "windows")]
pub use system::SystemLoopback;

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: u32 = 2;
pub const MAX_PACKET_FRAMES: u32 = 4800;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioError {
    UnsupportedPlatform,
    DeviceUnavailable,
    InvalidPacket,
    InvalidProcess,
    ActivationTimedOut,
    Stopped,
}

fn validate_process_id(pid: u32) -> Result<(), AudioError> {
    if pid == 0 {
        return Err(AudioError::InvalidProcess);
    }
    Ok(())
}

/// PCM stays in the native audio pipeline, never JSON/IPC/React state.
pub struct AudioPacket {
    pub samples: Vec<i16>,
    pub discontinuity: bool,
}

#[cfg(any(test, target_os = "windows"))]
fn sample_count(frames: u32) -> Result<usize, AudioError> {
    if frames == 0 || frames > MAX_PACKET_FRAMES {
        return Err(AudioError::InvalidPacket);
    }
    Ok((frames * CHANNELS) as usize)
}

#[cfg(not(target_os = "windows"))]
pub struct SystemLoopback;

#[cfg(not(target_os = "windows"))]
impl SystemLoopback {
    pub fn start() -> Result<Self, AudioError> {
        Err(AudioError::UnsupportedPlatform)
    }
    pub fn start_process(pid: u32) -> Result<Self, AudioError> {
        validate_process_id(pid)?;
        Err(AudioError::UnsupportedPlatform)
    }
    pub fn start_process_verified(pid: u32, expected_creation: u64) -> Result<Self, AudioError> {
        validate_process_id(pid)?;
        if expected_creation == 0 {
            return Err(AudioError::InvalidProcess);
        }
        Err(AudioError::UnsupportedPlatform)
    }
    pub fn read(&mut self) -> Result<Option<AudioPacket>, AudioError> {
        Err(AudioError::UnsupportedPlatform)
    }
    pub fn set_paused(&mut self, _paused: bool) -> Result<(), AudioError> {
        Err(AudioError::UnsupportedPlatform)
    }
    pub fn stop(&mut self) -> Result<(), AudioError> {
        Err(AudioError::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_interleaved_pcm_packets_without_guessing_audio_content() {
        assert_eq!(sample_count(480), Ok(960));
        assert_eq!(sample_count(MAX_PACKET_FRAMES), Ok(9600));
        assert_eq!(sample_count(0), Err(AudioError::InvalidPacket));
        assert_eq!(
            sample_count(MAX_PACKET_FRAMES + 1),
            Err(AudioError::InvalidPacket)
        );
    }
    #[test]
    #[cfg(not(target_os = "windows"))]
    fn unsupported_platform_does_not_open_audio() {
        assert!(matches!(
            SystemLoopback::start(),
            Err(AudioError::UnsupportedPlatform)
        ));
        assert!(matches!(
            SystemLoopback::start_process(42),
            Err(AudioError::UnsupportedPlatform)
        ));
        assert!(matches!(
            SystemLoopback::start_process(0),
            Err(AudioError::InvalidProcess)
        ));
        assert!(matches!(
            SystemLoopback::start_process_verified(42, 0),
            Err(AudioError::InvalidProcess)
        ));
        assert!(matches!(
            SystemLoopback::start_process_verified(42, 1),
            Err(AudioError::UnsupportedPlatform)
        ));
    }
    #[test]
    fn process_capture_requires_an_explicit_nonzero_process_id() {
        assert_eq!(validate_process_id(0), Err(AudioError::InvalidProcess));
        assert_eq!(validate_process_id(42), Ok(()));
    }
}
