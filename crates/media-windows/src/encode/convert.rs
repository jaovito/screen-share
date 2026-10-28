use super::EncoderError;
use crate::{EncoderOperation, NativeFrame};
use ss_domain::VideoProfile;
use std::mem::ManuallyDrop;
use windows::{
    Win32::{
        Foundation::RECT,
        Graphics::{
            Direct3D11::*,
            Dxgi::Common::{
                DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
                DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709, DXGI_FORMAT_B8G8R8A8_UNORM,
                DXGI_FORMAT_NV12, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
            },
        },
    },
    core::Interface,
};

pub(super) struct Nv12Frame {
    pub texture: ID3D11Texture2D,
    pub timestamp_100ns: i64,
}

/// SDR BT.709 conversion/scaling stays on the capture device. There is no CPU
/// readback or software fallback. Letterboxing preserves source aspect ratio.
pub(super) struct Converter {
    device: ID3D11Device,
    context: ID3D11VideoContext1,
    video: ID3D11VideoDevice,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    input_size: (u32, u32),
    profile: VideoProfile,
}

impl Converter {
    pub fn new(frame: &NativeFrame, profile: VideoProfile) -> Result<Self, EncoderError> {
        let device =
            unsafe { frame.texture().GetDevice() }.map_err(|_| EncoderError::DeviceUnavailable)?;
        let video: ID3D11VideoDevice = device
            .cast()
            .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;
        let immediate =
            unsafe { device.GetImmediateContext() }.map_err(|_| EncoderError::DeviceUnavailable)?;
        let context: ID3D11VideoContext1 = immediate
            .cast()
            .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;
        let multithread: ID3D11Multithread = immediate
            .cast()
            .map_err(|_| EncoderError::DeviceUnavailable)?;
        if !unsafe { multithread.GetMultithreadProtected() }.as_bool() {
            return Err(EncoderError::DeviceUnavailable);
        }
        let (enumerator, processor) =
            Self::processor(&video, frame.width(), frame.height(), profile)?;

        Ok(Self {
            device,
            context,
            video,
            enumerator,
            processor,
            input_size: (frame.width(), frame.height()),
            profile,
        })
    }

    pub fn device(&self) -> &ID3D11Device {
        &self.device
    }

    fn processor(
        video: &ID3D11VideoDevice,
        width: u32,
        height: u32,
        profile: VideoProfile,
    ) -> Result<(ID3D11VideoProcessorEnumerator, ID3D11VideoProcessor), EncoderError> {
        let rate = DXGI_RATIONAL {
            Numerator: u32::from(profile.fps),
            Denominator: 1,
        };
        let description = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: rate,
            InputWidth: width,
            InputHeight: height,
            OutputFrameRate: rate,
            OutputWidth: u32::from(profile.width),
            OutputHeight: u32::from(profile.height),
            Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
        };
        let enumerator = unsafe { video.CreateVideoProcessorEnumerator(&description) }
            .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;
        let input_support =
            unsafe { enumerator.CheckVideoProcessorFormat(DXGI_FORMAT_B8G8R8A8_UNORM) }
                .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;
        let output_support = unsafe { enumerator.CheckVideoProcessorFormat(DXGI_FORMAT_NV12) }
            .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;
        if input_support & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_INPUT.0 as u32 == 0
            || output_support & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT.0 as u32 == 0
        {
            return Err(EncoderError::UnsupportedOperation(
                EncoderOperation::GpuProcessor,
            ));
        }
        let extended: ID3D11VideoProcessorEnumerator1 = enumerator
            .cast()
            .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;
        let supported = unsafe {
            extended.CheckVideoProcessorFormatConversion(
                DXGI_FORMAT_B8G8R8A8_UNORM,
                DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
                DXGI_FORMAT_NV12,
                DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
            )
        }
        .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;
        if !supported.as_bool() {
            return Err(EncoderError::UnsupportedOperation(
                EncoderOperation::GpuProcessor,
            ));
        }
        let processor = unsafe { video.CreateVideoProcessor(&enumerator, 0) }
            .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;

        Ok((enumerator, processor))
    }

    pub fn convert(&mut self, frame: &NativeFrame) -> Result<Nv12Frame, EncoderError> {
        let source_device =
            unsafe { frame.texture().GetDevice() }.map_err(|_| EncoderError::DeviceUnavailable)?;
        if source_device != self.device {
            return Err(EncoderError::DeviceChanged);
        }
        if self.input_size != (frame.width(), frame.height()) {
            let (enumerator, processor) =
                Self::processor(&self.video, frame.width(), frame.height(), self.profile)?;
            self.enumerator = enumerator;
            self.processor = processor;
            self.input_size = (frame.width(), frame.height());
        }
        let description = D3D11_TEXTURE2D_DESC {
            Width: u32::from(self.profile.width),
            Height: u32::from(self.profile.height),
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_NV12,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut output = None;
        unsafe {
            self.device
                .CreateTexture2D(&description, None, Some(&mut output))
        }
        .map_err(|_| EncoderError::DeviceUnavailable)?;
        let output = output.ok_or(EncoderError::DeviceUnavailable)?;
        let input_description = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            FourCC: 0,
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPIV {
                    MipSlice: 0,
                    ArraySlice: 0,
                },
            },
        };
        let output_description = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
            },
        };
        let mut input_view = None;
        let mut output_view = None;
        unsafe {
            self.video
                .CreateVideoProcessorInputView(
                    frame.texture(),
                    &self.enumerator,
                    &input_description,
                    Some(&mut input_view),
                )
                .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;
            self.video
                .CreateVideoProcessorOutputView(
                    &output,
                    &self.enumerator,
                    &output_description,
                    Some(&mut output_view),
                )
                .map_err(|error| super::setup::native(EncoderOperation::GpuProcessor, error))?;
        }
        let input_view = input_view.ok_or(EncoderError::GpuConversionUnsupported)?;
        let output_view = output_view.ok_or(EncoderError::GpuConversionUnsupported)?;
        let source = RECT {
            left: 0,
            top: 0,
            right: frame.width() as i32,
            bottom: frame.height() as i32,
        };
        let target = RECT {
            left: 0,
            top: 0,
            right: i32::from(self.profile.width),
            bottom: i32::from(self.profile.height),
        };
        let destination = fit_rect(frame.width(), frame.height(), self.profile)?;
        let black = D3D11_VIDEO_COLOR {
            Anonymous: D3D11_VIDEO_COLOR_0 {
                RGBA: D3D11_VIDEO_COLOR_RGBA {
                    R: 0.0,
                    G: 0.0,
                    B: 0.0,
                    A: 1.0,
                },
            },
        };
        unsafe {
            self.context.VideoProcessorSetStreamFrameFormat(
                &self.processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );
            self.context
                .VideoProcessorSetStreamSourceRect(&self.processor, 0, true, Some(&source));
            self.context.VideoProcessorSetStreamDestRect(
                &self.processor,
                0,
                true,
                Some(&destination),
            );
            self.context
                .VideoProcessorSetOutputTargetRect(&self.processor, true, Some(&target));
            self.context
                .VideoProcessorSetOutputBackgroundColor(&self.processor, false, &black);
            self.context.VideoProcessorSetStreamColorSpace1(
                &self.processor,
                0,
                DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
            );
            self.context.VideoProcessorSetOutputColorSpace1(
                &self.processor,
                DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
            );
        }
        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            pInputSurface: ManuallyDrop::new(Some(input_view)),
            ..Default::default()
        };
        let result = unsafe {
            self.context.VideoProcessorBlt(
                &self.processor,
                &output_view,
                0,
                std::slice::from_ref(&stream),
            )
        };
        // The ABI uses ManuallyDrop; release its owned COM reference on every path.
        unsafe { ManuallyDrop::drop(&mut stream.pInputSurface) };
        result.map_err(|error| super::setup::native(EncoderOperation::GpuConversion, error))?;

        Ok(Nv12Frame {
            texture: output,
            timestamp_100ns: frame.timestamp_100ns(),
        })
    }
}

fn fit_rect(width: u32, height: u32, profile: VideoProfile) -> Result<RECT, EncoderError> {
    if width == 0 || height == 0 {
        return Err(EncoderError::InvalidInput);
    }
    let target_width = u64::from(profile.width);
    let target_height = u64::from(profile.height);
    let (scaled_width, scaled_height) =
        if u64::from(width) * target_height > target_width * u64::from(height) {
            (
                target_width,
                (u64::from(height) * target_width / u64::from(width)) & !1,
            )
        } else {
            (
                (u64::from(width) * target_height / u64::from(height)) & !1,
                target_height,
            )
        };
    if scaled_width < 2 || scaled_height < 2 {
        return Err(EncoderError::InvalidInput);
    }
    let left = ((target_width - scaled_width) / 2) & !1;
    let top = ((target_height - scaled_height) / 2) & !1;

    Ok(RECT {
        left: left as i32,
        top: top as i32,
        right: (left + scaled_width) as i32,
        bottom: (top + scaled_height) as i32,
    })
}
