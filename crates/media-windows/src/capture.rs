//! WGC acquisition primitive. Not wired to IPC or publication until authorization,
//! encoder/transport integration, and hardware validation are complete.
//! This acquisition path requests SDR BGRA; it does not implement HDR tone mapping.

mod device;
mod frame;
mod picker;
mod resources;
#[cfg(test)]
mod tests;

pub use frame::NativeFrame;
pub use picker::{PickedSource, pick_source, supported};

use device::Device;
use frame::{FrameProcessor, validate_size};
use ss_application::{FrameQueueCounters, LatestFrameQueue};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use windows::{
    Foundation::TypedEventHandler,
    Graphics::{
        Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession},
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
    },
    core::IInspectable,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureError {
    Unsupported,
    PickerFailed,
    PlatformFailure,
    DeviceUnavailable,
    DeviceLost,
    RecoveryExhausted,
    InvalidSize,
    UnsupportedFormat,
    FrameFailed,
    QueueFailed,
    CleanupFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureStatus {
    Capturing,
    SourceClosed,
    Failed(CaptureError),
    Stopped,
}

struct Shared {
    frames: LatestFrameQueue<NativeFrame>,
    status: Mutex<CaptureStatus>,
    stopped: AtomicBool,
    paused: AtomicBool,
    faulted: AtomicBool,
    generation: AtomicU64,
}

impl Shared {
    fn accepts(&self, generation: u64) -> bool {
        !self.stopped.load(Ordering::Acquire)
            && !self.paused.load(Ordering::Acquire)
            && !self.faulted.load(Ordering::Acquire)
            && generation == self.generation.load(Ordering::Acquire)
    }

    #[cfg(test)]
    fn fault(&self, error: CaptureError) {
        self.fault_at(error, None);
    }

    fn fault_at(&self, error: CaptureError, expected: Option<u64>) -> bool {
        let Ok(mut status) = self.status.lock() else {
            self.stopped.store(true, Ordering::Release);
            let _ = self.frames.close();
            return false;
        };
        if self.stopped.load(Ordering::Acquire)
            || expected.is_some_and(|value| value != self.generation.load(Ordering::Acquire))
        {
            return false;
        }
        if error == CaptureError::DeviceLost {
            self.faulted.store(true, Ordering::Release);
            if self.frames.clear().is_err() {
                self.stopped.store(true, Ordering::Release);
                let _ = self.frames.close();
                *status = CaptureStatus::Failed(CaptureError::QueueFailed);
            } else {
                *status = CaptureStatus::Failed(error);
            }
        } else {
            self.stopped.store(true, Ordering::Release);
            let _ = self.frames.close();
            *status = CaptureStatus::Failed(error);
        }
        true
    }

    fn end(&self, status: CaptureStatus) {
        if let Ok(mut current) = self.status.lock() {
            self.stopped.store(true, Ordering::Release);
            let _ = self.frames.close();
            *current = status;
        } else {
            self.stopped.store(true, Ordering::Release);
            let _ = self.frames.close();
        }
    }
}

/// Cloneable consumer view of the existing one-frame slot. It cannot select,
/// start, or stop capture, and carries no apartment-local WinRT interfaces.
#[derive(Clone)]
pub struct CaptureReader {
    shared: Arc<Shared>,
}

impl CaptureReader {
    /// Linearizes one synchronous publication against source closure, pause,
    /// device-loss status and resource-generation commit. Never await or perform
    /// GPU/MF work in this closure; it is for the bounded SDK enqueue only.
    pub fn with_generation<T>(
        &self,
        expected: u64,
        operation: impl FnOnce() -> T,
    ) -> Result<Option<T>, CaptureError> {
        let status = self
            .shared
            .status
            .lock()
            .map_err(|_| CaptureError::PlatformFailure)?;
        if *status != CaptureStatus::Capturing || !self.shared.accepts(expected) {
            return Ok(None);
        }
        Ok(Some(operation()))
    }

    /// Report only a proven DXGI device-removal HRESULT from the encoder bound
    /// to this generation. A late old-device failure cannot invalidate its replacement.
    pub fn report_device_loss(&self, expected: u64) -> bool {
        self.shared
            .fault_at(CaptureError::DeviceLost, Some(expected))
    }

    pub fn generation(&self) -> u64 {
        self.shared.generation.load(Ordering::Acquire)
    }

    pub fn status(&self) -> Result<CaptureStatus, CaptureError> {
        self.shared
            .status
            .lock()
            .map(|status| *status)
            .map_err(|_| CaptureError::PlatformFailure)
    }

    pub fn take_frame(&self) -> Result<Option<NativeFrame>, CaptureError> {
        if self.shared.stopped.load(Ordering::Acquire)
            || self.shared.paused.load(Ordering::Acquire)
            || self.shared.faulted.load(Ordering::Acquire)
        {
            return Ok(None);
        }
        let frame = self
            .shared
            .frames
            .take()
            .map_err(|_| CaptureError::QueueFailed)?;
        if self.shared.stopped.load(Ordering::Acquire)
            || self.shared.paused.load(Ordering::Acquire)
            || self.shared.faulted.load(Ordering::Acquire)
        {
            return Ok(None);
        }
        Ok(frame.filter(|frame| self.shared.accepts(frame.generation())))
    }

    pub fn queue_counters(&self) -> Result<FrameQueueCounters, CaptureError> {
        self.shared
            .frames
            .counters()
            .map_err(|_| CaptureError::QueueFailed)
    }
}

/// Owns one exact picker item, frame pool/session, and event registrations.
/// Creation starts capture, so only trusted composition may call this after
/// explicit selection and verified authorization/encryption readiness.
/// The projected device deliberately keeps this owner apartment-local.
pub struct NativeCapture {
    selected: PickedSource,
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    frame_token: Option<i64>,
    closed_token: Option<i64>,
    shared: Arc<Shared>,
    _projected_device: IDirect3DDevice,
    session_closed: bool,
    pool_closed: bool,
    processor: Arc<Mutex<FrameProcessor>>,
    recovery: crate::recovery::RecoveryBudget,
    recovery_clock: std::time::Instant,
    device_check: std::time::Instant,
}

impl NativeCapture {
    pub fn start(selected: PickedSource) -> Result<Self, CaptureError> {
        if !supported()? {
            return Err(CaptureError::Unsupported);
        }
        let size = selected
            .item
            .Size()
            .map_err(|_| CaptureError::FrameFailed)?;
        validate_size(size)?;
        let device = Device::new()?;
        let projected = device.projected()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &projected,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .map_err(|_| CaptureError::PlatformFailure)?;
        let session = pool
            .CreateCaptureSession(&selected.item)
            .map_err(|_| CaptureError::PlatformFailure)?;
        let shared = Arc::new(Shared {
            frames: LatestFrameQueue::new(),
            status: Mutex::new(CaptureStatus::Capturing),
            stopped: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            faulted: AtomicBool::new(false),
            generation: AtomicU64::new(0),
        });
        let processor = Arc::new(Mutex::new(FrameProcessor {
            device,
            pool_size: size,
            sequence: 0,
            generation: 0,
        }));
        let recovery = crate::recovery::RecoveryBudget::new(selected.identity());
        let mut capture = Self {
            selected,
            pool,
            session,
            frame_token: None,
            closed_token: None,
            shared,
            _projected_device: projected,
            session_closed: false,
            pool_closed: false,
            processor: processor.clone(),
            recovery,
            recovery_clock: std::time::Instant::now(),
            device_check: std::time::Instant::now(),
        };
        capture.install_handlers(processor)?;
        capture
            .session
            .StartCapture()
            .map_err(|_| CaptureError::PlatformFailure)?;

        Ok(capture)
    }

    pub fn source_identity(&self) -> u64 {
        self.selected.identity()
    }

    pub fn reader(&self) -> CaptureReader {
        CaptureReader {
            shared: self.shared.clone(),
        }
    }

    pub fn status(&self) -> Result<CaptureStatus, CaptureError> {
        self.reader().status()
    }

    /// A native consumer takes ownership. No pixels cross JSON/IPC/React.
    /// The owner must also observe status and stop promptly after any failure.
    pub fn take_frame(&self) -> Result<Option<NativeFrame>, CaptureError> {
        self.reader().take_frame()
    }

    pub fn queue_counters(&self) -> Result<FrameQueueCounters, CaptureError> {
        self.reader().queue_counters()
    }

    /// Stop producing owned textures while preserving the exact consent item.
    /// WGC notifications are drained without conversion/copy while paused.
    pub fn set_output_paused(&self, paused: bool) -> Result<(), CaptureError> {
        let _status = self
            .shared
            .status
            .lock()
            .map_err(|_| CaptureError::PlatformFailure)?;
        if paused {
            self.shared.paused.store(true, Ordering::Release);
            self.shared
                .frames
                .clear()
                .map_err(|_| CaptureError::QueueFailed)?;
        } else {
            self.shared
                .frames
                .clear()
                .map_err(|_| CaptureError::QueueFailed)?;
            self.shared.paused.store(false, Ordering::Release);
        }
        Ok(())
    }

    /// Disconnect callbacks, close capture/pool and release the pending texture.
    /// Already-running callbacks see stopped and cannot repopulate the closed queue.
    pub fn stop(&mut self) -> Result<(), CaptureError> {
        self.recovery.cancel();
        self.shared.end(CaptureStatus::Stopped);
        let mut failed = false;
        if let Some(token) = self.frame_token {
            if close_succeeded(self.pool.RemoveFrameArrived(token)) {
                self.frame_token = None;
            } else {
                failed = true;
            }
        }
        if let Some(token) = self.closed_token {
            if close_succeeded(self.selected.item.RemoveClosed(token)) {
                self.closed_token = None;
            } else {
                failed = true;
            }
        }
        if !self.session_closed {
            self.session_closed = close_succeeded(self.session.Close());
            failed |= !self.session_closed;
        }
        if !self.pool_closed {
            self.pool_closed = close_succeeded(self.pool.Close());
            failed |= !self.pool_closed;
        }
        if failed {
            self.shared
                .end(CaptureStatus::Failed(CaptureError::CleanupFailed));
            return Err(CaptureError::CleanupFailed);
        }

        Ok(())
    }

    fn install_handlers(
        &mut self,
        processor: Arc<Mutex<FrameProcessor>>,
    ) -> Result<(), CaptureError> {
        let shared = self.shared.clone();
        self.frame_token = Some(
            self.pool
                .FrameArrived(
                    &TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(
                        move |sender, _| {
                            if shared.stopped.load(Ordering::Acquire)
                                || shared.faulted.load(Ordering::Acquire)
                            {
                                return Ok(());
                            }
                            let Some(pool) = sender.as_ref() else {
                                shared.end(CaptureStatus::Failed(CaptureError::FrameFailed));
                                return Ok(());
                            };
                            if shared.paused.load(Ordering::Acquire) {
                                if let Ok(frame) = pool.TryGetNextFrame() {
                                    let _ = frame.Close();
                                }
                                return Ok(());
                            }
                            let (generation, result) = match processor.lock() {
                                Ok(mut processor) => (processor.generation, processor.next(pool)),
                                Err(_) => {
                                    shared.end(CaptureStatus::Failed(CaptureError::FrameFailed));
                                    return Ok(());
                                }
                            };
                            match result {
                                Ok(Some(frame)) if !shared.stopped.load(Ordering::Acquire) => {
                                    let frame_generation = frame.generation();
                                    if shared
                                        .frames
                                        .push_if(frame, || shared.accepts(frame_generation))
                                        .is_err()
                                        && !shared.stopped.load(Ordering::Acquire)
                                    {
                                        shared
                                            .end(CaptureStatus::Failed(CaptureError::QueueFailed));
                                    }
                                }
                                Err(error) if !shared.stopped.load(Ordering::Acquire) => {
                                    shared.fault_at(error, Some(generation));
                                }
                                _ => {}
                            }
                            Ok(())
                        },
                    ),
                )
                .map_err(|_| CaptureError::PlatformFailure)?,
        );

        let shared = self.shared.clone();
        self.closed_token = Some(
            self.selected
                .item
                .Closed(
                    &TypedEventHandler::<GraphicsCaptureItem, IInspectable>::new(move |_, _| {
                        if shared.stopped.load(Ordering::Acquire) {
                            return Ok(());
                        }
                        shared.end(CaptureStatus::SourceClosed);
                        // Owner-apartment stop/drop closes resources. The callback only
                        // makes the original item terminal, so Close cannot race Recreate.
                        Ok(())
                    }),
                )
                .map_err(|_| CaptureError::PlatformFailure)?,
        );

        Ok(())
    }
}

impl Drop for NativeCapture {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn close_succeeded(result: windows::core::Result<()>) -> bool {
    // RO_E_CLOSED is success for idempotent cleanup of already-closed objects.
    result.is_ok() || result.is_err_and(|error| error.code().0 as u32 == 0x80000013)
}
