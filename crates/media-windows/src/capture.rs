//! WGC acquisition primitive. Not wired to IPC or publication until authorization,
//! encoder/transport integration, and hardware validation are complete.
//! This acquisition path requests SDR BGRA; it does not implement HDR tone mapping.

mod device;
mod frame;
mod picker;

pub use frame::NativeFrame;
pub use picker::{PickedSource, pick_source, supported};

use device::Device;
use frame::{FrameProcessor, validate_size};
use ss_application::{FrameQueueCounters, LatestFrameQueue};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
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
}

impl Shared {
    fn end(&self, status: CaptureStatus) {
        self.stopped.store(true, Ordering::Release);
        let _ = self.frames.close();
        if let Ok(mut current) = self.status.lock() {
            *current = status;
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
    pub fn status(&self) -> Result<CaptureStatus, CaptureError> {
        self.shared
            .status
            .lock()
            .map(|status| *status)
            .map_err(|_| CaptureError::PlatformFailure)
    }

    pub fn take_frame(&self) -> Result<Option<NativeFrame>, CaptureError> {
        if self.shared.stopped.load(Ordering::Acquire) {
            return Ok(None);
        }
        let frame = self
            .shared
            .frames
            .take()
            .map_err(|_| CaptureError::QueueFailed)?;
        if self.shared.stopped.load(Ordering::Acquire) {
            return Ok(None);
        }
        Ok(frame)
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
        });
        let processor = Arc::new(Mutex::new(FrameProcessor {
            device,
            pool_size: size,
            sequence: 0,
        }));
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

    /// Disconnect callbacks, close capture/pool and release the pending texture.
    /// Already-running callbacks see stopped and cannot repopulate the closed queue.
    pub fn stop(&mut self) -> Result<(), CaptureError> {
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
                            if shared.stopped.load(Ordering::Acquire) {
                                return Ok(());
                            }
                            let Some(pool) = sender.as_ref() else {
                                shared.end(CaptureStatus::Failed(CaptureError::FrameFailed));
                                return Ok(());
                            };
                            let result = processor
                                .lock()
                                .map_err(|_| CaptureError::FrameFailed)
                                .and_then(|mut processor| processor.next(pool));
                            match result {
                                Ok(Some(frame)) if !shared.stopped.load(Ordering::Acquire) => {
                                    if shared.frames.push(frame).is_err()
                                        && !shared.stopped.load(Ordering::Acquire)
                                    {
                                        shared
                                            .end(CaptureStatus::Failed(CaptureError::QueueFailed));
                                    }
                                }
                                Err(error) if !shared.stopped.load(Ordering::Acquire) => {
                                    shared.end(CaptureStatus::Failed(error));
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
        let pool = self.pool.clone();
        let session = self.session.clone();
        self.closed_token = Some(
            self.selected
                .item
                .Closed(
                    &TypedEventHandler::<GraphicsCaptureItem, IInspectable>::new(move |_, _| {
                        if shared.stopped.load(Ordering::Acquire) {
                            return Ok(());
                        }
                        shared.end(CaptureStatus::SourceClosed);
                        // Only the original item is closed. Never recreate another source.
                        let session_closed = close_succeeded(session.Close());
                        let pool_closed = close_succeeded(pool.Close());
                        if !session_closed || !pool_closed {
                            shared.end(CaptureStatus::Failed(CaptureError::CleanupFailed));
                        }
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
