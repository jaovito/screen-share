use super::{CaptureError, device::Device};
use windows::{
    Graphics::{
        Capture::{Direct3D11CaptureFrame, Direct3D11CaptureFramePool},
        DirectX::DirectXPixelFormat,
        SizeInt32,
    },
    Win32::{
        Graphics::{
            Direct3D11::{
                D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_BOX,
                D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, ID3D11Texture2D,
            },
            Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
        },
        System::WinRT::Direct3D11::IDirect3DDxgiInterfaceAccess,
    },
    core::Interface,
};

/// Owns a copied GPU texture independently of the reusable WGC frame pool.
/// There is one GPU copy, no readback, and no zero-copy performance claim.
pub struct NativeFrame {
    texture: ID3D11Texture2D,
    width: u32,
    height: u32,
    sequence: u64,
    timestamp_100ns: i64,
    generation: u64,
}

impl NativeFrame {
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn texture(&self) -> &ID3D11Texture2D {
        &self.texture
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    /// WGC's system-relative frame timestamp, not end-to-end latency.
    pub fn timestamp_100ns(&self) -> i64 {
        self.timestamp_100ns
    }
}

pub(super) struct FrameProcessor {
    pub device: Device,
    pub pool_size: SizeInt32,
    pub sequence: u64,
    pub generation: u64,
}

impl FrameProcessor {
    pub fn next(
        &mut self,
        pool: &Direct3D11CaptureFramePool,
    ) -> Result<Option<NativeFrame>, CaptureError> {
        let frame = match pool.TryGetNextFrame() {
            Ok(frame) => frame,
            // A coalesced notification can leave an empty pool. Nothing is emitted.
            Err(error) if [0x8000000A_u32, 0x80004003_u32].contains(&(error.code().0 as u32)) => {
                return Ok(None);
            }
            Err(error) => return Err(classify(error, CaptureError::FrameFailed)),
        };
        let content_size = frame
            .ContentSize()
            .map_err(|error| classify(error, CaptureError::FrameFailed));
        let result = content_size.and_then(|size| self.copy(&frame, size));
        // Always return the WGC frame before resizing/recreating its pool.
        let closed = frame
            .Close()
            .map_err(|error| classify(error, CaptureError::FrameFailed));
        let result = result?;
        closed?;

        if let Ok(size) = content_size
            && size.Width > 0
            && size.Height > 0
            && size != self.pool_size
        {
            validate_size(size)?;
            let device = self.device.projected()?;
            pool.Recreate(&device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size)
                .map_err(|error| classify(error, CaptureError::FrameFailed))?;
            self.pool_size = size;
        }

        Ok(result)
    }

    fn copy(
        &mut self,
        frame: &Direct3D11CaptureFrame,
        size: SizeInt32,
    ) -> Result<Option<NativeFrame>, CaptureError> {
        // Minimized/inactive sources can have no content. Never manufacture frames.
        if size.Width <= 0 || size.Height <= 0 {
            return Ok(None);
        }
        validate_size(size)?;
        let surface = frame
            .Surface()
            .map_err(|error| classify(error, CaptureError::FrameFailed))?;
        let access: IDirect3DDxgiInterfaceAccess = surface
            .cast()
            .map_err(|error| classify(error, CaptureError::FrameFailed))?;
        let source: ID3D11Texture2D = unsafe { access.GetInterface() }
            .map_err(|error| classify(error, CaptureError::FrameFailed))?;
        let mut description = D3D11_TEXTURE2D_DESC::default();
        unsafe { source.GetDesc(&mut description) };
        if description.Format != DXGI_FORMAT_B8G8R8A8_UNORM || description.SampleDesc.Count != 1 {
            return Err(CaptureError::UnsupportedFormat);
        }
        let width = size.Width as u32;
        let height = size.Height as u32;
        // The first resized frame may exceed the old allocation. Recreate first;
        // no uninitialized/truncated pixels from that frame enter the queue.
        if width > description.Width || height > description.Height {
            return Ok(None);
        }

        description.Width = width;
        description.Height = height;
        description.MipLevels = 1;
        description.ArraySize = 1;
        description.Usage = D3D11_USAGE_DEFAULT;
        description.BindFlags = (D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET).0 as u32;
        description.CPUAccessFlags = 0;
        description.MiscFlags = 0;
        let mut destination = None;
        unsafe {
            self.device
                .native
                .CreateTexture2D(&description, None, Some(&mut destination))
        }
        .map_err(|error| classify(error, CaptureError::DeviceUnavailable))?;
        let destination = destination.ok_or(CaptureError::DeviceUnavailable)?;
        let bounds = D3D11_BOX {
            left: 0,
            top: 0,
            front: 0,
            right: width,
            bottom: height,
            back: 1,
        };
        unsafe {
            self.device.context.CopySubresourceRegion(
                &destination,
                0,
                0,
                0,
                0,
                &source,
                0,
                Some(&bounds),
            );
        }
        unsafe { self.device.native.GetDeviceRemovedReason() }
            .map_err(|error| classify(error, CaptureError::FrameFailed))?;
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or(CaptureError::FrameFailed)?;
        let timestamp_100ns = frame
            .SystemRelativeTime()
            .map_err(|error| classify(error, CaptureError::FrameFailed))?
            .Duration;

        Ok(Some(NativeFrame {
            texture: destination,
            width,
            height,
            sequence: self.sequence,
            timestamp_100ns,
            generation: self.generation,
        }))
    }
}

pub(super) fn validate_size(size: SizeInt32) -> Result<(), CaptureError> {
    if size.Width <= 0
        || size.Height <= 0
        || size.Width > 8192
        || size.Height > 8192
        || i64::from(size.Width) * i64::from(size.Height) > 3840 * 2160
    {
        return Err(CaptureError::InvalidSize);
    }

    Ok(())
}

pub(super) fn classify(error: windows::core::Error, fallback: CaptureError) -> CaptureError {
    if crate::recovery::device_lost_hresult(error.code().0) {
        CaptureError::DeviceLost
    } else {
        fallback
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_native_allocation_and_rejects_zero_size() {
        for (width, height) in [(0, 1080), (1920, -1), (8193, 1), (3840, 2161)] {
            assert_eq!(
                validate_size(SizeInt32 {
                    Width: width,
                    Height: height
                }),
                Err(CaptureError::InvalidSize),
            );
        }
        for (width, height) in [(1920, 1080), (3840, 2160), (5120, 1440)] {
            assert_eq!(
                validate_size(SizeInt32 {
                    Width: width,
                    Height: height
                }),
                Ok(())
            );
        }
    }
}
