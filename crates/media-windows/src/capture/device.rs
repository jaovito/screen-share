use super::CaptureError;
use windows::{
    Graphics::DirectX::Direct3D11::IDirect3DDevice,
    Win32::{
        Foundation::HMODULE,
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::{
                D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                D3D11_SDK_VERSION, D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext,
                ID3D11Multithread,
            },
            Dxgi::IDXGIDevice,
        },
        System::WinRT::Direct3D11::CreateDirect3D11DeviceFromDXGIDevice,
    },
    core::Interface,
};

pub(super) struct Device {
    pub native: ID3D11Device,
    pub context: ID3D11DeviceContext,
}

impl Device {
    pub fn new() -> Result<Self, CaptureError> {
        let mut native = None;
        let mut context = None;
        // Hardware-only capture. A software fallback would hide unsupported hardware.
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut native),
                None,
                Some(&mut context),
            )
        }
        .map_err(|_| CaptureError::DeviceUnavailable)?;
        let native = native.ok_or(CaptureError::DeviceUnavailable)?;
        let context = context.ok_or(CaptureError::DeviceUnavailable)?;
        let multithread: ID3D11Multithread = context
            .cast()
            .map_err(|_| CaptureError::DeviceUnavailable)?;
        // WGC callbacks and the future encoder can use this device on different
        // threads; the immediate context must never be used unprotected.
        let _ = unsafe { multithread.SetMultithreadProtected(true) };
        if !unsafe { multithread.GetMultithreadProtected() }.as_bool() {
            return Err(CaptureError::DeviceUnavailable);
        }

        Ok(Self { native, context })
    }

    pub fn projected(&self) -> Result<IDirect3DDevice, CaptureError> {
        let dxgi: IDXGIDevice = self
            .native
            .cast()
            .map_err(|_| CaptureError::DeviceUnavailable)?;
        unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }
            .and_then(|device| device.cast())
            .map_err(|_| CaptureError::DeviceUnavailable)
    }
}
