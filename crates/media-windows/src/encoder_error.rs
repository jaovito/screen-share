#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderError {
    InvalidInput,
    DeviceUnavailable,
    DeviceChanged,
    GpuConversionUnsupported,
    GpuConversionFailed,
    HardwareEncoderUnavailable,
    UnsupportedEncoder,
    PlatformFailure,
    EncoderFailed,
    InvalidOutput,
    Closed,
    UnsupportedOperation(crate::EncoderOperation),
    Native {
        operation: crate::EncoderOperation,
        hresult: i32,
    },
}
