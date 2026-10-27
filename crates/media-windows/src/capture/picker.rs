use super::CaptureError;
use std::sync::atomic::{AtomicU64, Ordering};
use windows::{
    Graphics::Capture::{GraphicsCaptureItem, GraphicsCapturePicker, GraphicsCaptureSession},
    Win32::{Foundation::HWND, UI::Shell::IInitializeWithWindow},
    core::Interface,
};

static NEXT_SELECTION: AtomicU64 = AtomicU64::new(1);

/// Owns the exact object returned by Windows consent UI. No title is read and
/// there is no window/monitor enumeration or fallback source resolution.
pub struct PickedSource {
    pub(super) item: GraphicsCaptureItem,
    pub(super) identity: u64,
}

impl PickedSource {
    /// Process-local identity, deliberately unrelated to a title or reusable HWND.
    pub fn identity(&self) -> u64 {
        self.identity
    }
}

pub fn supported() -> Result<bool, CaptureError> {
    GraphicsCaptureSession::IsSupported().map_err(|_| CaptureError::PlatformFailure)
}

/// Shows Windows consent UI without starting capture. Cancellation selects nothing.
///
/// # Safety
/// The caller must initialize WinRT on the owning UI thread and supply its live
/// top-level HWND. Poll this future on that UI thread while its message loop runs.
/// Do not block that thread waiting synchronously for picker completion.
pub async unsafe fn pick_source(owner: HWND) -> Result<Option<PickedSource>, CaptureError> {
    if owner.0.is_null() || !supported()? {
        return Err(CaptureError::Unsupported);
    }
    let picker = GraphicsCapturePicker::new().map_err(|_| CaptureError::PickerFailed)?;
    let initialize: IInitializeWithWindow =
        picker.cast().map_err(|_| CaptureError::PickerFailed)?;
    unsafe { initialize.Initialize(owner) }.map_err(|_| CaptureError::PickerFailed)?;
    let pending = picker
        .PickSingleItemAsync()
        .map_err(|_| CaptureError::PickerFailed)?;

    match pending.await {
        Ok(item) => {
            let identity = NEXT_SELECTION
                .try_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                    value.checked_add(1)
                })
                .map_err(|_| CaptureError::PickerFailed)?;
            Ok(Some(PickedSource { item, identity }))
        }
        // A canceled operation or a null item from the system picker is not consent.
        Err(error) if [0x80004004_u32, 0x80004003_u32].contains(&(error.code().0 as u32)) => {
            Ok(None)
        }
        Err(_) => Err(CaptureError::PickerFailed),
    }
}
