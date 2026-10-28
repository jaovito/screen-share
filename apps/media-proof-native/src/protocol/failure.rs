use super::SharingReason;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureStage {
    EncoderInitialization,
    EncoderInput,
    EncoderOutput,
    EncoderControl,
    Capture,
    Audio,
    Transport,
    Worker,
    Cleanup,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureCode {
    HardwareEncoderUnavailable,
    UnsupportedEncoder,
    DeviceUnavailable,
    DeviceChanged,
    GpuConversionUnsupported,
    GpuConversionFailed,
    InvalidInput,
    InvalidOutput,
    PlatformFailure,
    EncoderFailed,
    EncoderClosed,
    NativeCallFailed,
    CaptureFailed,
    AudioFailed,
    TransportFailed,
    WorkerFailed,
    CleanupFailed,
}

pub const OPERATIONS: &[&str] = &[
    "mf_enumerate",
    "mf_activate",
    "mf_attributes",
    "mf_async_unlock",
    "mf_low_latency",
    "mf_b_frames",
    "mf_rate_control",
    "mf_bitrate",
    "mf_keyframe",
    "mf_device_manager",
    "mf_output_type",
    "mf_input_type",
    "mf_begin_streaming",
    "mf_start_streaming",
    "mf_header",
    "mf_submit",
    "mf_poll",
    "mf_output",
    "mf_async_capability",
    "mf_d3d11_capability",
    "mf_codec_interface",
    "mf_event_interface",
    "mf_stream_count",
    "mf_stream_ids",
    "gpu_processor",
    "gpu_conversion",
];

/// Closed metadata only: never vendor descriptions, arbitrary errors, keys or media.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeFailure {
    pub stage: FailureStage,
    pub code: FailureCode,
    pub operation: Option<String>,
    pub hresult: Option<i32>,
}

impl NativeFailure {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self
            .operation
            .as_ref()
            .is_some_and(|name| !OPERATIONS.contains(&name.as_str()))
        {
            return Err("invalid_failure_operation");
        }
        Ok(())
    }

    pub fn reason(&self) -> SharingReason {
        match self.stage {
            FailureStage::EncoderInitialization
            | FailureStage::EncoderInput
            | FailureStage::EncoderOutput
            | FailureStage::EncoderControl => SharingReason::EncoderFailed,
            FailureStage::Capture => SharingReason::CaptureFailed,
            FailureStage::Audio | FailureStage::Transport => SharingReason::TransportFailed,
            FailureStage::Worker => SharingReason::WorkerFailed,
            FailureStage::Cleanup => SharingReason::CleanupFailed,
        }
    }

    pub fn worker(message: &str) -> Self {
        let (stage, code) = match message {
            "Hardware encoder initialization failed or capabilities are unsupported"
            | "Hardware encoder initialization failed" => (
                FailureStage::EncoderInitialization,
                FailureCode::EncoderFailed,
            ),
            "Asynchronous hardware encoding failed" => {
                (FailureStage::EncoderOutput, FailureCode::EncoderFailed)
            }
            "GPU conversion or hardware encoder input failed" => {
                (FailureStage::EncoderInput, FailureCode::EncoderFailed)
            }
            "Hardware bitrate feedback failed" | "Hardware keyframe request failed" => {
                (FailureStage::EncoderControl, FailureCode::EncoderFailed)
            }
            "Scoped encrypted publication setup failed"
            | "Encoded publication failed or its lease became invalid"
            | "Publication authorization or transport became unavailable"
            | "RTC bitrate is below the hardware encoder minimum; publication stopped"
            | "RTC frame rate is unavailable or stopped; publication stopped" => {
                (FailureStage::Transport, FailureCode::TransportFailed)
            }
            "Native capture failed; no fallback source was selected"
            | "Native capture frame unavailable"
            | "Authorized capture startup timed out" => {
                (FailureStage::Capture, FailureCode::CaptureFailed)
            }
            "Requested system audio is unavailable"
            | "Selected application audio is unavailable"
            | "System audio device became unavailable"
            | "Encrypted audio publication failed" => {
                (FailureStage::Audio, FailureCode::AudioFailed)
            }
            "Hardware encoder cleanup failed"
            | "System audio cleanup failed"
            | "Encrypted publication cleanup failed" => {
                (FailureStage::Cleanup, FailureCode::CleanupFailed)
            }
            _ => (FailureStage::Worker, FailureCode::WorkerFailed),
        };
        Self {
            stage,
            code,
            operation: None,
            hresult: None,
        }
    }
}

/// Run every cleanup, but preserve the original media failure when teardown also fails.
pub fn finish_publication<T>(
    work: Result<T, &'static str>,
    cleanups: &[Result<(), &'static str>],
) -> Result<T, &'static str> {
    let value = work?;
    for cleanup in cleanups {
        (*cleanup)?;
    }
    Ok(value)
}
