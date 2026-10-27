use super::{CaptureError, CaptureStatus, NativeCapture, device::Device, frame::classify};
use std::sync::atomic::Ordering;
use windows::Graphics::DirectX::DirectXPixelFormat;

impl NativeCapture {
    /// Call on the original WGC owner apartment. The caller must keep this false
    /// while paused, reauthorizing, revoked or stopping. It never opens a picker,
    /// resolves an HWND, or replaces the immutable GraphicsCaptureItem/session.
    ///
    /// Only explicit DXGI device invalidation is recoverable. The same one-frame
    /// slot is emptied, and the generation changes before any new-device frame
    /// can be exposed. The encoder consumer must observe that generation.
    pub fn service_recovery(&mut self, permitted: bool) -> Result<bool, CaptureError> {
        if self.shared.stopped.load(Ordering::Acquire) {
            self.recovery.cancel();
            return Ok(false);
        }
        if permitted && self.device_check.elapsed() >= std::time::Duration::from_millis(100) {
            self.device_check = std::time::Instant::now();
            let (generation, reason) = {
                let processor = self
                    .processor
                    .lock()
                    .map_err(|_| CaptureError::PlatformFailure)?;
                (processor.generation, unsafe {
                    processor.device.native.GetDeviceRemovedReason()
                })
            };
            if let Err(error) = reason {
                self.shared.fault_at(
                    classify(error, CaptureError::DeviceUnavailable),
                    Some(generation),
                );
            }
        }
        if self.status()? != CaptureStatus::Failed(CaptureError::DeviceLost) {
            return Ok(false);
        }
        let now_ms = self
            .recovery_clock
            .elapsed()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        let source = self.source_identity();
        if self.recovery.failed(source, now_ms).is_err() {
            return self.recovery_exhausted();
        }
        let due = self
            .recovery
            .poll(source, now_ms, permitted)
            .map_err(|_| CaptureError::RecoveryExhausted)?;
        if !due {
            return Ok(false);
        }
        let result = self.rebuild_device();
        match result {
            Ok(recovered) => Ok(recovered),
            Err(CaptureError::DeviceLost | CaptureError::DeviceUnavailable) => {
                if self.recovery.failed(source, now_ms).is_err() {
                    return self.recovery_exhausted();
                }
                Ok(false)
            }
            Err(error) => {
                self.shared.end(CaptureStatus::Failed(error));
                Err(error)
            }
        }
    }

    fn recovery_exhausted(&self) -> Result<bool, CaptureError> {
        self.shared
            .end(CaptureStatus::Failed(CaptureError::RecoveryExhausted));
        Err(CaptureError::RecoveryExhausted)
    }

    fn rebuild_device(&mut self) -> Result<bool, CaptureError> {
        let mut processor = self
            .processor
            .lock()
            .map_err(|_| CaptureError::PlatformFailure)?;
        if self.shared.stopped.load(Ordering::Acquire) {
            return Ok(false);
        }
        let device = Device::new()?;
        let projected = device.projected()?;
        // Recreate is the WGC device-loss path. All borrowed frames were closed
        // by next() before releasing this same processor mutex.
        self.pool
            .Recreate(
                &projected,
                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                2,
                processor.pool_size,
            )
            .map_err(|error| classify(error, CaptureError::PlatformFailure))?;
        let mut status = self
            .shared
            .status
            .lock()
            .map_err(|_| CaptureError::PlatformFailure)?;
        // Closed/Stop may race the native call; neither can authorize restarting.
        if self.shared.stopped.load(Ordering::Acquire) {
            return Ok(false);
        }
        self.shared
            .frames
            .clear()
            .map_err(|_| CaptureError::QueueFailed)?;
        let generation = processor
            .generation
            .checked_add(1)
            .ok_or(CaptureError::RecoveryExhausted)?;
        processor.device = device;
        processor.generation = generation;
        self._projected_device = projected;
        self.shared.generation.store(generation, Ordering::Release);
        *status = CaptureStatus::Capturing;
        self.shared.faulted.store(false, Ordering::Release);
        Ok(true)
    }
}
