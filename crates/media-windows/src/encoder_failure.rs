/// Closed operation names; diagnostics never include COM descriptions or content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderOperation {
    Enumerate,
    Activate,
    Attributes,
    AsyncUnlock,
    LowLatency,
    BFrames,
    RateControl,
    Bitrate,
    Keyframe,
    DeviceManager,
    OutputType,
    InputType,
    BeginStreaming,
    StartStreaming,
    Header,
    Submit,
    Poll,
    Output,
    AsyncCapability,
    D3d11Capability,
    CodecInterface,
    EventInterface,
    StreamCount,
    StreamIds,
    GpuProcessor,
    GpuConversion,
}

impl EncoderOperation {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Enumerate => "mf_enumerate",
            Self::Activate => "mf_activate",
            Self::Attributes => "mf_attributes",
            Self::AsyncUnlock => "mf_async_unlock",
            Self::LowLatency => "mf_low_latency",
            Self::BFrames => "mf_b_frames",
            Self::RateControl => "mf_rate_control",
            Self::Bitrate => "mf_bitrate",
            Self::Keyframe => "mf_keyframe",
            Self::DeviceManager => "mf_device_manager",
            Self::OutputType => "mf_output_type",
            Self::InputType => "mf_input_type",
            Self::BeginStreaming => "mf_begin_streaming",
            Self::StartStreaming => "mf_start_streaming",
            Self::Header => "mf_header",
            Self::Submit => "mf_submit",
            Self::Poll => "mf_poll",
            Self::Output => "mf_output",
            Self::AsyncCapability => "mf_async_capability",
            Self::D3d11Capability => "mf_d3d11_capability",
            Self::CodecInterface => "mf_codec_interface",
            Self::EventInterface => "mf_event_interface",
            Self::StreamCount => "mf_stream_count",
            Self::StreamIds => "mf_stream_ids",
            Self::GpuProcessor => "gpu_processor",
            Self::GpuConversion => "gpu_conversion",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operations_have_unique_fixed_content_free_codes() {
        let operations = [
            EncoderOperation::Enumerate,
            EncoderOperation::Activate,
            EncoderOperation::Attributes,
            EncoderOperation::AsyncUnlock,
            EncoderOperation::LowLatency,
            EncoderOperation::BFrames,
            EncoderOperation::RateControl,
            EncoderOperation::Bitrate,
            EncoderOperation::Keyframe,
            EncoderOperation::DeviceManager,
            EncoderOperation::OutputType,
            EncoderOperation::InputType,
            EncoderOperation::BeginStreaming,
            EncoderOperation::StartStreaming,
            EncoderOperation::Header,
            EncoderOperation::Submit,
            EncoderOperation::Poll,
            EncoderOperation::Output,
            EncoderOperation::AsyncCapability,
            EncoderOperation::D3d11Capability,
            EncoderOperation::CodecInterface,
            EncoderOperation::EventInterface,
            EncoderOperation::StreamCount,
            EncoderOperation::StreamIds,
            EncoderOperation::GpuProcessor,
            EncoderOperation::GpuConversion,
        ];
        let mut codes = std::collections::HashSet::new();
        for operation in operations {
            let code = operation.code();
            assert!(code.starts_with("mf_") || code.starts_with("gpu_"));
            assert!(
                code.bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
            );
            assert!(codes.insert(code));
        }
    }
}
