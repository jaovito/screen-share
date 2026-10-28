use super::Signals;
use ss_media_proof::protocol::{FailureCode, FailureStage, NativeFailure};
use ss_media_windows::EncoderError;

pub(super) fn encoder(signals: &Signals, stage: FailureStage, error: EncoderError) {
    let mut failure = NativeFailure {
        stage,
        code: FailureCode::EncoderFailed,
        operation: None,
        hresult: None,
    };
    failure.code = match error {
        EncoderError::InvalidInput => FailureCode::InvalidInput,
        EncoderError::DeviceUnavailable => FailureCode::DeviceUnavailable,
        EncoderError::DeviceChanged => FailureCode::DeviceChanged,
        EncoderError::GpuConversionUnsupported => FailureCode::GpuConversionUnsupported,
        EncoderError::GpuConversionFailed => FailureCode::GpuConversionFailed,
        EncoderError::HardwareEncoderUnavailable => FailureCode::HardwareEncoderUnavailable,
        EncoderError::UnsupportedEncoder => FailureCode::UnsupportedEncoder,
        EncoderError::PlatformFailure => FailureCode::PlatformFailure,
        EncoderError::EncoderFailed => FailureCode::EncoderFailed,
        EncoderError::InvalidOutput => FailureCode::InvalidOutput,
        EncoderError::Closed => FailureCode::EncoderClosed,
        EncoderError::UnsupportedOperation(operation) => {
            failure.operation = Some(operation.code().into());
            FailureCode::UnsupportedEncoder
        }
        EncoderError::Native { operation, hresult } => {
            failure.operation = Some(operation.code().into());
            failure.hresult = Some(hresult);
            FailureCode::NativeCallFailed
        }
    };
    if let Ok(mut snapshot) = signals.snapshot.lock() {
        snapshot.failure.get_or_insert(failure);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::{PipelineReport, Snapshot, WorkerPhase};
    use ss_domain::VideoProfile;
    use ss_media_windows::EncoderOperation;
    use std::sync::{Arc, Mutex, atomic::AtomicBool};
    use std::time::Instant;

    fn signals() -> Signals {
        Signals {
            stop: Arc::new(AtomicBool::new(false)),
            paused: Arc::new(AtomicBool::new(false)),
            snapshot: Arc::new(Mutex::new(Snapshot {
                phase: WorkerPhase::Connecting,
                failure: None,
                report: PipelineReport::default(),
                profile: VideoProfile::new(1080, 60).unwrap(),
                target_fps: 60.0,
                heartbeat: Instant::now(),
                adaptation_reason: None,
                target_bitrate_bps: None,
                diagnostics_generation: 0,
                diagnostics_elapsed_ms: 0,
                conversion_submission_ms: None,
                encoder_output_latency_ms: None,
                available_send_bitrate_bps: None,
                manual_bitrate_bps: None,
            })),
        }
    }

    #[test]
    fn preserves_numeric_driver_failure_and_first_stage_without_arbitrary_text() {
        let signals = signals();
        encoder(
            &signals,
            FailureStage::EncoderInitialization,
            EncoderError::Native {
                operation: EncoderOperation::OutputType,
                hresult: -1072875852,
            },
        );
        encoder(&signals, FailureStage::Cleanup, EncoderError::Closed);
        let failure = signals.snapshot.lock().unwrap().failure.clone().unwrap();
        assert_eq!(failure.stage, FailureStage::EncoderInitialization);
        assert_eq!(failure.code, FailureCode::NativeCallFailed);
        assert_eq!(failure.operation.as_deref(), Some("mf_output_type"));
        assert_eq!(failure.hresult, Some(-1072875852));
        assert!(failure.validate().is_ok());
        for (error, code) in [
            (EncoderError::InvalidInput, FailureCode::InvalidInput),
            (
                EncoderError::DeviceUnavailable,
                FailureCode::DeviceUnavailable,
            ),
            (EncoderError::DeviceChanged, FailureCode::DeviceChanged),
            (
                EncoderError::GpuConversionUnsupported,
                FailureCode::GpuConversionUnsupported,
            ),
            (
                EncoderError::GpuConversionFailed,
                FailureCode::GpuConversionFailed,
            ),
            (
                EncoderError::HardwareEncoderUnavailable,
                FailureCode::HardwareEncoderUnavailable,
            ),
            (
                EncoderError::UnsupportedEncoder,
                FailureCode::UnsupportedEncoder,
            ),
            (EncoderError::PlatformFailure, FailureCode::PlatformFailure),
            (EncoderError::EncoderFailed, FailureCode::EncoderFailed),
            (EncoderError::InvalidOutput, FailureCode::InvalidOutput),
            (EncoderError::Closed, FailureCode::EncoderClosed),
            (
                EncoderError::UnsupportedOperation(EncoderOperation::D3d11Capability),
                FailureCode::UnsupportedEncoder,
            ),
        ] {
            let current = self::signals();
            encoder(&current, FailureStage::EncoderInput, error);
            assert_eq!(
                current
                    .snapshot
                    .lock()
                    .unwrap()
                    .failure
                    .as_ref()
                    .unwrap()
                    .code,
                code
            );
        }
    }
}
