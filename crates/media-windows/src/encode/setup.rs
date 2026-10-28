use super::EncoderError;
use crate::EncoderOperation;
use ss_domain::VideoProfile;
use std::{mem::ManuallyDrop, ptr};
use windows::{
    Win32::{
        Graphics::Direct3D11::ID3D11Device,
        Media::MediaFoundation::*,
        System::{
            Com::CoTaskMemFree,
            Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_BOOL, VT_UI4},
        },
    },
    core::{GUID, Interface},
};

pub(super) struct Runtime {
    active: bool,
}
impl Runtime {
    pub fn new() -> Result<Self, EncoderError> {
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET) }
            .map_err(|_| EncoderError::PlatformFailure)?;
        Ok(Self { active: true })
    }

    pub fn shutdown(&mut self) -> Result<(), EncoderError> {
        if self.active {
            unsafe { MFShutdown() }.map_err(|_| EncoderError::EncoderFailed)?;
            self.active = false;
        }
        Ok(())
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

pub(super) struct Transform {
    pub value: IMFTransform,
    closed: bool,
}
impl Transform {
    fn new(value: IMFTransform) -> Self {
        Self {
            value,
            closed: false,
        }
    }

    pub fn shutdown(&mut self) -> Result<(), EncoderError> {
        if !self.closed {
            // Abort queued data. Shutdown remains mandatory even if flush fails.
            let _ = unsafe { self.value.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0) };
            let _ = unsafe {
                self.value
                    .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0)
            };
            let shutdown = self
                .value
                .cast::<IMFShutdown>()
                .map_err(|_| EncoderError::EncoderFailed)?;
            if let Err(error) = unsafe { shutdown.Shutdown() }
                && error.code() != MF_E_SHUTDOWN
            {
                return Err(EncoderError::EncoderFailed);
            }
            self.closed = true;
        }
        Ok(())
    }
}
impl Drop for Transform {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

struct Activations {
    values: *mut Option<IMFActivate>,
    count: u32,
}
impl Drop for Activations {
    fn drop(&mut self) {
        if !self.values.is_null() {
            for index in 0..self.count as usize {
                unsafe { ptr::drop_in_place(self.values.add(index)) };
            }
            unsafe { CoTaskMemFree(Some(self.values.cast())) };
        }
    }
}

pub(super) struct ConfiguredTransform {
    pub transform: Transform,
    pub events: IMFMediaEventGenerator,
    pub codec: ICodecAPI,
    pub _manager: IMFDXGIDeviceManager,
    pub input_id: u32,
    pub output_id: u32,
}

pub(super) fn select(
    device: &ID3D11Device,
    profile: VideoProfile,
    bitrate: u32,
) -> Result<ConfiguredTransform, EncoderError> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_H264,
    };
    let mut activations = Activations {
        values: ptr::null_mut(),
        count: 0,
    };
    unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            Some(&input),
            Some(&output),
            &mut activations.values,
            &mut activations.count,
        )
    }
    .map_err(|error| native(EncoderOperation::Enumerate, error))?;
    if activations.values.is_null() || activations.count == 0 {
        return Err(EncoderError::HardwareEncoderUnavailable);
    }
    // Initialization is bounded even on a host with many installed vendor MFTs.
    let mut last = EncoderError::HardwareEncoderUnavailable;
    for index in 0..activations.count.min(16) as usize {
        let activation = unsafe { &*activations.values.add(index) };
        if let Some(activation) = activation {
            match configure(activation, device, profile, bitrate) {
                Ok(configured) => return Ok(configured),
                Err(error) => last = error,
            }
        }
    }

    Err(last)
}

fn configure(
    activation: &IMFActivate,
    device: &ID3D11Device,
    profile: VideoProfile,
    bitrate: u32,
) -> Result<ConfiguredTransform, EncoderError> {
    let transform = Transform::new(
        unsafe { activation.ActivateObject::<IMFTransform>() }
            .map_err(|error| native(EncoderOperation::Activate, error))?,
    );
    let attributes = unsafe { transform.value.GetAttributes() }
        .map_err(|error| native(EncoderOperation::Attributes, error))?;
    if unsafe { attributes.GetUINT32(&MF_TRANSFORM_ASYNC) }.unwrap_or(0) != 1 {
        return Err(EncoderError::UnsupportedOperation(
            EncoderOperation::AsyncCapability,
        ));
    }
    if unsafe { attributes.GetUINT32(&MF_SA_D3D11_AWARE) }.unwrap_or(0) != 1 {
        return Err(EncoderError::UnsupportedOperation(
            EncoderOperation::D3d11Capability,
        ));
    }
    unsafe { attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1) }
        .map_err(|error| native(EncoderOperation::AsyncUnlock, error))?;
    let codec: ICodecAPI = transform
        .value
        .cast()
        .map_err(|error| native(EncoderOperation::CodecInterface, error))?;
    set_bool(&codec, &CODECAPI_AVLowLatencyMode, true)?;
    // Baseline excludes B slices. Do not require the optional B-picture CodecAPI
    // property: some hardware MFTs reject it even for zero. Output SPS is checked.
    set_u32(
        &codec,
        &CODECAPI_AVEncCommonRateControlMode,
        eAVEncCommonRateControlMode_CBR.0 as u32,
    )?;
    set_u32(&codec, &CODECAPI_AVEncCommonMeanBitRate, bitrate)?;
    let mut reset_token = 0;
    let mut manager = None;
    unsafe { MFCreateDXGIDeviceManager(&mut reset_token, &mut manager) }
        .map_err(|error| native(EncoderOperation::DeviceManager, error))?;
    let manager = manager.ok_or(EncoderError::DeviceUnavailable)?;
    unsafe {
        manager
            .ResetDevice(device, reset_token)
            .map_err(|error| native(EncoderOperation::DeviceManager, error))?;
        transform
            .value
            .ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize)
            .map_err(|error| native(EncoderOperation::DeviceManager, error))?;
    }
    let (mut input_count, mut output_count) = (0, 0);
    unsafe {
        transform
            .value
            .GetStreamCount(&mut input_count, &mut output_count)
    }
    .map_err(|error| native(EncoderOperation::StreamCount, error))?;
    if (input_count, output_count) != (1, 1) {
        return Err(EncoderError::UnsupportedOperation(
            EncoderOperation::StreamCount,
        ));
    }
    let (mut input_ids, mut output_ids) = ([0], [0]);
    if let Err(error) = unsafe {
        transform
            .value
            .GetStreamIDs(&mut input_ids, &mut output_ids)
    } && error.code().0 as u32 != 0x80004001
    {
        return Err(native(EncoderOperation::StreamIds, error));
    }
    let output = media_type(profile, MFVideoFormat_H264)?;
    unsafe {
        output
            .SetUINT32(&MF_MT_AVG_BITRATE, bitrate)
            .map_err(|_| EncoderError::UnsupportedEncoder)?;
        output
            .SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base.0 as u32)
            .map_err(|_| EncoderError::UnsupportedEncoder)?;
        transform
            .value
            .SetOutputType(output_ids[0], &output, 0)
            .map_err(|error| native(EncoderOperation::OutputType, error))?;
        transform
            .value
            .SetInputType(input_ids[0], &media_type(profile, MFVideoFormat_NV12)?, 0)
            .map_err(|error| native(EncoderOperation::InputType, error))?;
    }
    let events = transform
        .value
        .cast()
        .map_err(|error| native(EncoderOperation::EventInterface, error))?;
    unsafe {
        transform
            .value
            .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)
            .map_err(|error| native(EncoderOperation::BeginStreaming, error))?;
        transform
            .value
            .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)
            .map_err(|error| native(EncoderOperation::StartStreaming, error))?;
    }

    Ok(ConfiguredTransform {
        transform,
        events,
        codec,
        _manager: manager,
        input_id: input_ids[0],
        output_id: output_ids[0],
    })
}

fn media_type(profile: VideoProfile, subtype: GUID) -> Result<IMFMediaType, EncoderError> {
    let media_type = unsafe { MFCreateMediaType() }.map_err(|_| EncoderError::PlatformFailure)?;
    let result = unsafe {
        (|| -> windows::core::Result<()> {
            media_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            media_type.SetGUID(&MF_MT_SUBTYPE, &subtype)?;
            media_type.SetUINT64(
                &MF_MT_FRAME_SIZE,
                (u64::from(profile.width) << 32) | u64::from(profile.height),
            )?;
            media_type.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(profile.fps) << 32) | 1)?;
            media_type.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1_u64 << 32) | 1)?;
            media_type.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            media_type.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
            media_type.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
            media_type.SetUINT32(&MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709.0 as u32)?;
            media_type.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32)?;
            Ok(())
        })()
    };
    result.map_err(|_| EncoderError::UnsupportedEncoder)?;
    Ok(media_type)
}

pub(super) fn set_u32(codec: &ICodecAPI, property: &GUID, value: u32) -> Result<(), EncoderError> {
    let variant = VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_UI4,
                Anonymous: VARIANT_0_0_0 { ulVal: value },
                ..Default::default()
            }),
        },
    };
    unsafe { codec.SetValue(property, &variant) }.map_err(|error| {
        let operation = if *property == CODECAPI_AVEncMPVDefaultBPictureCount {
            EncoderOperation::BFrames
        } else if *property == CODECAPI_AVEncCommonRateControlMode {
            EncoderOperation::RateControl
        } else if *property == CODECAPI_AVEncVideoForceKeyFrame {
            EncoderOperation::Keyframe
        } else {
            EncoderOperation::Bitrate
        };
        native(operation, error)
    })
}

fn set_bool(codec: &ICodecAPI, property: &GUID, value: bool) -> Result<(), EncoderError> {
    let variant = VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_BOOL,
                Anonymous: VARIANT_0_0_0 {
                    boolVal: value.into(),
                },
                ..Default::default()
            }),
        },
    };
    unsafe { codec.SetValue(property, &variant) }
        .map_err(|error| native(EncoderOperation::LowLatency, error))
}

pub(super) fn native(operation: EncoderOperation, error: windows::core::Error) -> EncoderError {
    EncoderError::Native {
        operation,
        hresult: error.code().0,
    }
}
