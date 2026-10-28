//! Hardware-only SDR encoder primitive. Native execution and compatibility need
//! Windows/GPU evidence; these methods do not assert a measured performance gate.

mod convert;
mod h264;
mod output;
mod setup;

use crate::{
    EncoderDiagnostics, EncoderError, EncoderOperation, NativeFrame, encoder_timing::EncoderTiming,
};
use convert::Converter;
use h264::H264Normalizer;
use setup::{ConfiguredTransform, Runtime};
use ss_domain::{EncodedAccessUnit, VideoProfile};
use std::{marker::PhantomData, rc::Rc, time::Instant};
use windows::{Win32::Media::MediaFoundation::*, core::Interface};

const MAX_IN_FLIGHT: usize = 2;
const MAX_INPUT_CREDITS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmitOutcome {
    Accepted,
    Backpressure,
}

pub enum EncoderPoll {
    Pending,
    NeedInput,
    Output(EncodedAccessUnit),
}

/// Create/use/stop on one initialized COM MTA owner thread. No thread is spawned,
/// no polling loop spins internally, and at most two samples are in flight. The
/// driver polls events on its bounded wakeup/timer and drains output promptly.
pub struct HardwareEncoder {
    converter: Option<Converter>,
    configured: Option<ConfiguredTransform>,
    normalizer: Option<H264Normalizer>,
    profile: VideoProfile,
    input_credits: usize,
    timing: EncoderTiming,
    diagnostic_clock: Instant,
    timestamp_origin: Option<i64>,
    last_timestamp: Option<i64>,
    _apartment: PhantomData<Rc<()>>,
    runtime: Option<Runtime>,
}

impl HardwareEncoder {
    pub fn new(
        frame: &NativeFrame,
        profile: VideoProfile,
        bitrate: u32,
    ) -> Result<Self, EncoderError> {
        if VideoProfile::new(profile.height, profile.fps) != Ok(profile)
            || !(64_000..=50_000_000).contains(&bitrate)
        {
            return Err(EncoderError::InvalidInput);
        }
        let runtime = Runtime::new()?;
        let converter = Converter::new(frame, profile)?;
        let configured = setup::select(converter.device(), profile, bitrate)?;
        let normalizer = output::header(&configured)?;

        Ok(Self {
            converter: Some(converter),
            configured: Some(configured),
            normalizer: Some(normalizer),
            profile,
            input_credits: 0,
            timing: EncoderTiming::default(),
            diagnostic_clock: Instant::now(),
            timestamp_origin: None,
            last_timestamp: None,
            _apartment: PhantomData,
            runtime: Some(runtime),
        })
    }

    /// Backpressure leaves conversion/capture ownership with the caller, which
    /// may replace its pending frame rather than enqueueing older native frames.
    pub fn submit(&mut self, frame: &NativeFrame) -> Result<SubmitOutcome, EncoderError> {
        let configured = self.configured.as_ref().ok_or(EncoderError::Closed)?;
        if self.input_credits == 0 || self.timing.pending() >= MAX_IN_FLIGHT {
            return Ok(SubmitOutcome::Backpressure);
        }
        if frame.timestamp_100ns() < 0
            || self
                .last_timestamp
                .is_some_and(|previous| frame.timestamp_100ns() <= previous)
        {
            return Err(EncoderError::InvalidInput);
        }
        let conversion_started = Instant::now();
        let frame = self
            .converter
            .as_mut()
            .ok_or(EncoderError::Closed)?
            .convert(frame)?;
        let conversion_us = conversion_started
            .elapsed()
            .as_micros()
            .min(u128::from(u64::MAX)) as u64;
        let origin = *self.timestamp_origin.get_or_insert(frame.timestamp_100ns);
        let timestamp = frame
            .timestamp_100ns
            .checked_sub(origin)
            .ok_or(EncoderError::InvalidInput)?;
        let buffer = unsafe {
            MFCreateDXGISurfaceBuffer(
                &windows::Win32::Graphics::Direct3D11::ID3D11Texture2D::IID,
                &frame.texture,
                0,
                false,
            )
        }
        .map_err(|_| EncoderError::EncoderFailed)?;
        let contiguous: IMF2DBuffer = buffer.cast().map_err(|_| EncoderError::EncoderFailed)?;
        let length =
            unsafe { contiguous.GetContiguousLength() }.map_err(|_| EncoderError::EncoderFailed)?;
        unsafe { buffer.SetCurrentLength(length) }.map_err(|_| EncoderError::EncoderFailed)?;
        let sample = unsafe { MFCreateSample() }.map_err(|_| EncoderError::PlatformFailure)?;
        unsafe {
            sample
                .AddBuffer(&buffer)
                .map_err(|_| EncoderError::EncoderFailed)?;
            sample
                .SetSampleTime(timestamp)
                .map_err(|_| EncoderError::EncoderFailed)?;
            sample
                .SetSampleDuration(10_000_000 / i64::from(self.profile.fps))
                .map_err(|_| EncoderError::EncoderFailed)?;
        }
        let submitted_us = self.elapsed_us();
        unsafe {
            configured
                .transform
                .value
                .ProcessInput(configured.input_id, &sample, 0)
                .map_err(|error| setup::native(EncoderOperation::Submit, error))?;
        }
        self.input_credits -= 1;
        self.timing
            .submitted(timestamp, submitted_us, conversion_us)
            .map_err(|_| EncoderError::InvalidInput)?;
        self.last_timestamp = Some(frame.timestamp_100ns);

        Ok(SubmitOutcome::Accepted)
    }

    /// Nonblocking event retrieval, one event per call. ProcessInput/ProcessOutput
    /// are invoked only against the corresponding asynchronous MFT event credit.
    pub fn poll(&mut self) -> Result<EncoderPoll, EncoderError> {
        let configured = self.configured.as_ref().ok_or(EncoderError::Closed)?;
        let event = match unsafe { configured.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } {
            Ok(event) => event,
            Err(error) if error.code() == MF_E_NO_EVENTS_AVAILABLE => {
                return Ok(EncoderPoll::Pending);
            }
            Err(error) => return Err(setup::native(EncoderOperation::Poll, error)),
        };
        unsafe { event.GetStatus() }
            .and_then(|status| status.ok())
            .map_err(|error| setup::native(EncoderOperation::Poll, error))?;
        let kind = unsafe { event.GetType() }.map_err(|_| EncoderError::EncoderFailed)?;
        if kind == METransformNeedInput.0 as u32 {
            let stream = unsafe { event.GetUINT32(&MF_EVENT_MFT_INPUT_STREAM_ID) }
                .map_err(|_| EncoderError::InvalidOutput)?;
            if stream != configured.input_id || self.input_credits >= MAX_INPUT_CREDITS {
                return Err(EncoderError::UnsupportedEncoder);
            }
            self.input_credits += 1;
            return Ok(EncoderPoll::NeedInput);
        }
        if kind == METransformHaveOutput.0 as u32 {
            let output = output::receive(
                configured,
                self.profile,
                self.normalizer.as_mut().ok_or(EncoderError::Closed)?,
            )?;
            self.timing
                .completed(output.timestamp_100ns, self.elapsed_us())
                .map_err(|_| EncoderError::InvalidOutput)?;
            let unit =
                EncodedAccessUnit::h264(output.bytes, self.profile, output.timestamp_100ns / 10)
                    .map_err(|_| EncoderError::InvalidOutput)?;
            return Ok(EncoderPoll::Output(unit));
        }

        Ok(EncoderPoll::Pending)
    }

    /// Only an actual DXGI invalidation authorizes rebuilding the retained
    /// capture device. Unsupported codecs and ordinary MFT errors remain fatal.
    pub fn device_lost(&self) -> bool {
        self.converter.as_ref().is_some_and(|converter| {
            unsafe { converter.device().GetDeviceRemovedReason() }
                .err()
                .is_some_and(|error| crate::recovery::device_lost_hresult(error.code().0))
        })
    }

    pub fn device_lost_for(frame: &NativeFrame) -> bool {
        unsafe { frame.texture().GetDevice() }
            .ok()
            .is_some_and(|device| {
                unsafe { device.GetDeviceRemovedReason() }
                    .err()
                    .is_some_and(|error| crate::recovery::device_lost_hresult(error.code().0))
            })
    }

    /// Five-second rolling observations. Output latency includes driver/MFT
    /// scheduling and GPU completion, rather than isolated codec execution.
    pub fn diagnostics(&self) -> EncoderDiagnostics {
        self.timing.snapshot(self.elapsed_us())
    }

    fn elapsed_us(&self) -> u64 {
        self.diagnostic_clock
            .elapsed()
            .as_micros()
            .min(u128::from(u64::MAX)) as u64
    }

    pub fn set_bitrate(&mut self, bitrate: u32) -> Result<(), EncoderError> {
        if !(64_000..=50_000_000).contains(&bitrate) {
            return Err(EncoderError::InvalidInput);
        }
        let configured = self.configured.as_ref().ok_or(EncoderError::Closed)?;
        setup::set_u32(&configured.codec, &CODECAPI_AVEncCommonMeanBitRate, bitrate)
    }

    pub fn request_keyframe(&mut self) -> Result<(), EncoderError> {
        let configured = self.configured.as_ref().ok_or(EncoderError::Closed)?;
        setup::set_u32(&configured.codec, &CODECAPI_AVEncVideoForceKeyFrame, 1)
    }

    /// Abort rather than draining old frames after authorization loss.
    pub fn stop(&mut self) -> Result<(), EncoderError> {
        if let Some(configured) = self.configured.as_mut() {
            configured.transform.shutdown()?;
        }
        self.timing = EncoderTiming::default();
        self.input_credits = 0;
        self.normalizer = None;
        self.configured = None;
        self.converter = None;
        if let Some(runtime) = self.runtime.as_mut() {
            runtime.shutdown()?;
        }
        self.runtime = None;

        Ok(())
    }
}

impl Drop for HardwareEncoder {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
