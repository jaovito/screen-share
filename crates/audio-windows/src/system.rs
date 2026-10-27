use crate::{AudioError, AudioPacket, CHANNELS, SAMPLE_RATE, sample_count};
use std::{marker::PhantomData, rc::Rc};
use windows::Win32::{
    Media::Audio::{
        AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY, AUDCLNT_BUFFERFLAGS_SILENT,
        AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK,
        AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, IAudioCaptureClient, IAudioClient,
        IMMDeviceEnumerator, MMDeviceEnumerator, WAVEFORMATEX, eConsole, eRender,
    },
    System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
    },
};

struct Apartment(PhantomData<Rc<()>>);
impl Apartment {
    fn enter() -> Result<Self, AudioError> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|_| AudioError::DeviceUnavailable)?;
        Ok(Self(PhantomData))
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

/// COM and its buffer acquire/release pair stay on the creating MTA thread.
pub struct SystemLoopback {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    active: bool,
    closed: bool,
    process: Option<crate::process::ProcessTarget>,
    _apartment: Apartment,
}

impl SystemLoopback {
    /// Caller must obtain explicit consent for the complete system-output scope.
    pub fn start() -> Result<Self, AudioError> {
        let apartment = Apartment::enter()?;
        let device: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|_| AudioError::DeviceUnavailable)?;
        let endpoint = unsafe { device.GetDefaultAudioEndpoint(eRender, eConsole) }
            .map_err(|_| AudioError::DeviceUnavailable)?;
        let client: IAudioClient = unsafe { endpoint.Activate(CLSCTX_ALL, None) }
            .map_err(|_| AudioError::DeviceUnavailable)?;
        Self::from_client(client, apartment, None)
    }

    /// Caller independently selects a process; this includes only its render
    /// streams and child-process tree. Failure never enables system capture.
    pub fn start_process(pid: u32) -> Result<Self, AudioError> {
        Self::open_process(pid, None)
    }

    /// Product callers bind the PID to the creation time observed by their
    /// explicit chooser, preventing substitution if a PID was reused meanwhile.
    pub fn start_process_verified(pid: u32, expected_creation: u64) -> Result<Self, AudioError> {
        if expected_creation == 0 {
            return Err(AudioError::InvalidProcess);
        }
        Self::open_process(pid, Some(expected_creation))
    }

    fn open_process(pid: u32, expected_creation: Option<u64>) -> Result<Self, AudioError> {
        crate::validate_process_id(pid)?;
        let apartment = Apartment::enter()?;
        let process = crate::process::ProcessTarget::open(pid, expected_creation)?;
        let client = crate::process::activate(&process)?;
        Self::from_client(client, apartment, Some(process))
    }

    fn from_client(
        client: IAudioClient,
        apartment: Apartment,
        process: Option<crate::process::ProcessTarget>,
    ) -> Result<Self, AudioError> {
        let format = WAVEFORMATEX {
            wFormatTag: 1,
            nChannels: CHANNELS as u16,
            nSamplesPerSec: SAMPLE_RATE,
            nAvgBytesPerSec: SAMPLE_RATE * CHANNELS * 2,
            nBlockAlign: (CHANNELS * 2) as u16,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        unsafe {
            client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK
                    | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                    | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                1_000_000,
                0,
                &format,
                None,
            )
        }
        .map_err(|_| AudioError::DeviceUnavailable)?;
        let capture = unsafe { client.GetService::<IAudioCaptureClient>() }
            .map_err(|_| AudioError::DeviceUnavailable)?;
        if let Some(target) = &process {
            target.check_live()?;
        }
        unsafe { client.Start() }.map_err(|_| AudioError::DeviceUnavailable)?;
        Ok(Self {
            client,
            capture,
            active: true,
            closed: false,
            process,
            _apartment: apartment,
        })
    }

    /// Reads at most one bounded OS packet. No application audio queue is added.
    pub fn read(&mut self) -> Result<Option<AudioPacket>, AudioError> {
        if self.closed {
            return Err(AudioError::Stopped);
        }
        self.check_process()?;
        if !self.active {
            return Ok(None);
        }
        let available = unsafe { self.capture.GetNextPacketSize() }
            .map_err(|_| AudioError::DeviceUnavailable)?;
        if available == 0 {
            return Ok(None);
        }
        let (mut pointer, mut frames, mut flags) = (std::ptr::null_mut(), 0, 0);
        unsafe {
            self.capture
                .GetBuffer(&mut pointer, &mut frames, &mut flags, None, None)
        }
        .map_err(|_| AudioError::DeviceUnavailable)?;
        // Every successful acquire is released on all paths, including a rejected
        // size/null packet. GetBuffer and ReleaseBuffer run on this same thread.
        let result = (|| {
            let count = sample_count(frames)?;
            let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
            let samples = if silent {
                vec![0; count]
            } else {
                if pointer.is_null() {
                    return Err(AudioError::InvalidPacket);
                }
                // WASAPI guarantees frames * format.nBlockAlign readable bytes
                // until ReleaseBuffer. read_unaligned does not assume driver alignment.
                (0..count)
                    .map(|index| unsafe { pointer.add(index * 2).cast::<i16>().read_unaligned() })
                    .collect()
            };
            Ok(Some(AudioPacket {
                samples,
                discontinuity: flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0,
            }))
        })();
        unsafe { self.capture.ReleaseBuffer(frames) }.map_err(|_| AudioError::DeviceUnavailable)?;
        result
    }

    pub fn set_paused(&mut self, paused: bool) -> Result<(), AudioError> {
        if self.closed {
            return Err(AudioError::Stopped);
        }
        self.check_process()?;
        if paused && self.active {
            unsafe { self.client.Stop() }.map_err(|_| AudioError::DeviceUnavailable)?;
            self.active = false;
            unsafe { self.client.Reset() }.map_err(|_| AudioError::DeviceUnavailable)?;
        } else if !paused && !self.active {
            unsafe { self.client.Start() }.map_err(|_| AudioError::DeviceUnavailable)?;
            self.active = true;
        }
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), AudioError> {
        if self.active {
            unsafe { self.client.Stop() }.map_err(|_| AudioError::DeviceUnavailable)?;
            self.active = false;
        }
        self.closed = true;
        self.process = None;
        Ok(())
    }

    fn check_process(&mut self) -> Result<(), AudioError> {
        if let Some(error) = self
            .process
            .as_ref()
            .and_then(|target| target.check_live().err())
        {
            let _ = self.stop();
            return Err(error);
        }
        Ok(())
    }
}
impl Drop for SystemLoopback {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
