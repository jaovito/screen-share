use super::{EncoderError, h264::H264Normalizer, setup::ConfiguredTransform};
use crate::EncoderOperation;
use ss_domain::{MAX_ACCESS_UNIT_BYTES, VideoProfile};
use std::{mem::ManuallyDrop, ptr};
use windows::Win32::Media::MediaFoundation::*;

pub(super) struct OutputSample {
    pub bytes: Vec<u8>,
    pub timestamp_100ns: i64,
}

struct OutputBuffer(MFT_OUTPUT_DATA_BUFFER);
impl Drop for OutputBuffer {
    fn drop(&mut self) {
        unsafe {
            ManuallyDrop::drop(&mut self.0.pSample);
            ManuallyDrop::drop(&mut self.0.pEvents);
        }
    }
}

impl OutputBuffer {
    fn take_sample(&mut self) -> Option<IMFSample> {
        let sample = unsafe { ManuallyDrop::take(&mut self.0.pSample) };
        self.0.pSample = ManuallyDrop::new(None);
        sample
    }
}

pub(super) fn header(configured: &ConfiguredTransform) -> Result<H264Normalizer, EncoderError> {
    let media_type = unsafe {
        configured
            .transform
            .value
            .GetOutputCurrentType(configured.output_id)
    }
    .map_err(|error| super::setup::native(EncoderOperation::Header, error))?;
    let size = unsafe { media_type.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER) }.unwrap_or(0) as usize;
    if size > 64 * 1024 {
        return Err(EncoderError::InvalidOutput);
    }
    let mut bytes = vec![0; size];
    if size > 0 {
        let mut actual = 0;
        unsafe { media_type.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut bytes, Some(&mut actual)) }
            .map_err(|_| EncoderError::InvalidOutput)?;
        if actual as usize != size {
            return Err(EncoderError::InvalidOutput);
        }
    }
    H264Normalizer::new(&bytes).map_err(|_| EncoderError::InvalidOutput)
}

/// Called exactly once per HaveOutput event, except for one bounded negotiation
/// retry when the transform reports STREAM_CHANGE. It never guesses readiness.
pub(super) fn receive(
    configured: &ConfiguredTransform,
    profile: VideoProfile,
    normalizer: &mut H264Normalizer,
) -> Result<OutputSample, EncoderError> {
    for attempt in 0..2 {
        let info = unsafe {
            configured
                .transform
                .value
                .GetOutputStreamInfo(configured.output_id)
        }
        .map_err(|_| EncoderError::EncoderFailed)?;
        let whole = (MFT_OUTPUT_STREAM_WHOLE_SAMPLES.0
            | MFT_OUTPUT_STREAM_SINGLE_SAMPLE_PER_BUFFER.0) as u32;
        if info.dwFlags & whole != whole {
            return Err(EncoderError::UnsupportedEncoder);
        }
        let provided = if info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 != 0 {
            None
        } else {
            if info.cbSize == 0
                || info.cbSize as usize > MAX_ACCESS_UNIT_BYTES
                || (info.cbAlignment > 1
                    && (!info.cbAlignment.is_power_of_two() || info.cbAlignment > 64))
            {
                return Err(EncoderError::UnsupportedEncoder);
            }
            let sample = unsafe { MFCreateSample() }.map_err(|_| EncoderError::PlatformFailure)?;
            let buffer = unsafe { MFCreateAlignedMemoryBuffer(info.cbSize, MF_64_BYTE_ALIGNMENT) }
                .map_err(|_| EncoderError::PlatformFailure)?;
            unsafe { sample.AddBuffer(&buffer) }.map_err(|_| EncoderError::EncoderFailed)?;
            Some(sample)
        };
        let mut output = OutputBuffer(MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: configured.output_id,
            pSample: ManuallyDrop::new(provided),
            ..Default::default()
        });
        let mut status = 0;
        let result = unsafe {
            configured.transform.value.ProcessOutput(
                0,
                std::slice::from_mut(&mut output.0),
                &mut status,
            )
        };
        if let Err(error) = result {
            if error.code() == MF_E_TRANSFORM_STREAM_CHANGE && attempt == 0 {
                negotiate(configured, profile)?;
                *normalizer = header(configured)?;
                continue;
            }
            return Err(super::setup::native(EncoderOperation::Output, error));
        }
        let sample = output.take_sample().ok_or(EncoderError::InvalidOutput)?;
        let timestamp_100ns =
            unsafe { sample.GetSampleTime() }.map_err(|_| EncoderError::InvalidOutput)?;
        let buffer = unsafe { sample.ConvertToContiguousBuffer() }
            .map_err(|_| EncoderError::InvalidOutput)?;
        let mut pointer = ptr::null_mut();
        let mut length = 0;
        unsafe { buffer.Lock(&mut pointer, None, Some(&mut length)) }
            .map_err(|_| EncoderError::InvalidOutput)?;
        let bytes = if pointer.is_null() || length == 0 || length as usize > MAX_ACCESS_UNIT_BYTES {
            Err(EncoderError::InvalidOutput)
        } else {
            // The MF lock owns this initialized span until Unlock below.
            Ok(unsafe { std::slice::from_raw_parts(pointer, length as usize) }.to_vec())
        };
        let unlocked = unsafe { buffer.Unlock() }.map_err(|_| EncoderError::EncoderFailed);
        let bytes = bytes?;
        unlocked?;
        // Revisit an initially absent header only after ProcessOutput succeeds.
        // Once negotiated or in-band SPS/PPS are known, this performs no MF query.
        normalizer.refresh_missing_header(|| header(configured))?;
        let bytes = normalizer
            .normalize(&bytes)
            .map_err(|_| EncoderError::InvalidOutput)?;

        return Ok(OutputSample {
            bytes,
            timestamp_100ns,
        });
    }
    Err(EncoderError::EncoderFailed)
}

fn negotiate(configured: &ConfiguredTransform, profile: VideoProfile) -> Result<(), EncoderError> {
    let media_type = unsafe {
        configured
            .transform
            .value
            .GetOutputAvailableType(configured.output_id, 0)
    }
    .map_err(|_| EncoderError::UnsupportedEncoder)?;
    let subtype = unsafe { media_type.GetGUID(&MF_MT_SUBTYPE) }
        .map_err(|_| EncoderError::UnsupportedEncoder)?;
    let size = unsafe { media_type.GetUINT64(&MF_MT_FRAME_SIZE) }
        .map_err(|_| EncoderError::UnsupportedEncoder)?;
    let expected = (u64::from(profile.width) << 32) | u64::from(profile.height);
    if subtype != MFVideoFormat_H264 || size != expected {
        return Err(EncoderError::UnsupportedEncoder);
    }
    unsafe {
        configured
            .transform
            .value
            .SetOutputType(configured.output_id, &media_type, 0)
    }
    .map_err(|_| EncoderError::UnsupportedEncoder)
}
