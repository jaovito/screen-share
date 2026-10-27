use crate::AudioError;
use std::{mem::ManuallyDrop, sync::mpsc, time::Duration};
use windows::{
    Win32::{
        Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT},
        Media::Audio::{
            AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
            AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
            ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
            IActivateAudioInterfaceCompletionHandler,
            IActivateAudioInterfaceCompletionHandler_Impl, IAudioClient,
            PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        },
        System::{
            Com::{
                BLOB,
                StructuredStorage::{
                    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
                },
            },
            Threading::{
                GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
                PROCESS_SYNCHRONIZE, WaitForSingleObject,
            },
            Variant::VT_BLOB,
        },
    },
    core::{ComObject, HRESULT, Interface, Ref, implement},
};

/// Retaining this object pins the selected process ID until capture is closed.
/// No process injection, memory inspection, or executable launch is performed.
pub(super) struct ProcessTarget {
    handle: HANDLE,
    pid: u32,
}

impl ProcessTarget {
    pub fn open(pid: u32, expected_creation: Option<u64>) -> Result<Self, AudioError> {
        crate::validate_process_id(pid)?;
        if expected_creation == Some(0) {
            return Err(AudioError::InvalidProcess);
        }
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                false,
                pid,
            )
        }
        .map_err(|_| AudioError::DeviceUnavailable)?;
        let target = Self { handle, pid };
        target.check_live()?;
        if let Some(expected) = expected_creation {
            let (mut creation, mut exit, mut kernel, mut user) = (
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
                FILETIME::default(),
            );
            unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) }
                .map_err(|_| AudioError::DeviceUnavailable)?;
            let actual =
                (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
            if actual != expected {
                return Err(AudioError::InvalidProcess);
            }
        }
        Ok(target)
    }

    pub fn check_live(&self) -> Result<(), AudioError> {
        match unsafe { WaitForSingleObject(self.handle, 0) } {
            WAIT_TIMEOUT => Ok(()),
            WAIT_OBJECT_0 => Err(AudioError::Stopped),
            _ => Err(AudioError::DeviceUnavailable),
        }
    }
}

impl Drop for ProcessTarget {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.handle) };
    }
}

/// `implement` supplies IAgileObject/IMarshal by default. The callback only sends
/// a bounded signal; it does not transfer an apartment-bound COM interface.
/// Parameters and their BLOB stay immutable and owned by the callback, which
/// Windows retains until completion even after our bounded wait has timed out.
#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Completion {
    signal: mpsc::SyncSender<()>,
    variant: PROPVARIANT,
    _params: Box<AUDIOCLIENT_ACTIVATION_PARAMS>,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for Completion_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Ref<'_, IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let _ = self.signal.try_send(());
        Ok(())
    }
}

pub(super) fn activate(target: &ProcessTarget) -> Result<IAudioClient, AudioError> {
    target.check_live()?;
    let mut params = Box::new(AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: target.pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    });
    // The BLOB borrows stable heap storage, not CoTaskMem. Never VariantClear
    // this borrowed variant: the callback owns and drops its Box exactly once.
    let variant = PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: (&mut *params as *mut AUDIOCLIENT_ACTIVATION_PARAMS).cast(),
                    },
                },
                ..Default::default()
            }),
        },
    };
    let (signal, completion) = mpsc::sync_channel(1);
    let owner = ComObject::new(Completion {
        signal,
        variant,
        _params: params,
    });
    let handler: IActivateAudioInterfaceCompletionHandler = owner.to_interface();
    let operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&owner.variant),
            &handler,
        )
    }
    .map_err(|_| AudioError::DeviceUnavailable)?;
    completion
        .recv_timeout(Duration::from_secs(5))
        .map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => AudioError::ActivationTimedOut,
            mpsc::RecvTimeoutError::Disconnected => AudioError::DeviceUnavailable,
        })?;
    let (mut result, mut client) = (HRESULT(0), None);
    unsafe { operation.GetActivateResult(&mut result, &mut client) }
        .map_err(|_| AudioError::DeviceUnavailable)?;
    result.ok().map_err(|_| AudioError::DeviceUnavailable)?;
    target.check_live()?;
    client
        .ok_or(AudioError::DeviceUnavailable)?
        .cast()
        .map_err(|_| AudioError::DeviceUnavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::{Com::IAgileObject, Threading::GetCurrentProcessId};

    #[test]
    fn completion_is_agile_and_late_or_duplicate_callbacks_never_block() {
        let (signal, received) = mpsc::sync_channel(1);
        let owner = ComObject::new(Completion {
            signal,
            variant: PROPVARIANT::default(),
            _params: Box::default(),
        });
        let handler: IActivateAudioInterfaceCompletionHandler = owner.to_interface();
        assert!(handler.cast::<IAgileObject>().is_ok());
        // Completion conveys only availability, never dereferences the passed
        // operation or touches a possibly-timed-out caller's stack.
        unsafe { handler.ActivateCompleted(None::<&IActivateAudioInterfaceAsyncOperation>) }
            .unwrap();
        unsafe { handler.ActivateCompleted(None::<&IActivateAudioInterfaceAsyncOperation>) }
            .unwrap();
        assert!(received.try_recv().is_ok());
        assert!(received.try_recv().is_err());
        drop(received);
        unsafe { handler.ActivateCompleted(None::<&IActivateAudioInterfaceAsyncOperation>) }
            .unwrap();
    }

    #[test]
    fn process_identity_must_match_actual_os_creation_time_before_activation() {
        let pid = unsafe { GetCurrentProcessId() };
        let target = ProcessTarget::open(pid, None).unwrap();
        let (mut creation, mut exit, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        unsafe {
            GetProcessTimes(
                target.handle,
                &mut creation,
                &mut exit,
                &mut kernel,
                &mut user,
            )
        }
        .unwrap();
        let identity =
            (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
        let verified = ProcessTarget::open(pid, Some(identity)).unwrap();
        assert_eq!(verified.check_live(), Ok(()));
        assert!(matches!(
            ProcessTarget::open(pid, Some(identity + 1)),
            Err(AudioError::InvalidProcess)
        ));
        assert!(matches!(
            ProcessTarget::open(0, None),
            Err(AudioError::InvalidProcess)
        ));
        assert!(matches!(
            ProcessTarget::open(pid, Some(0)),
            Err(AudioError::InvalidProcess)
        ));
        assert!(matches!(
            super::super::SystemLoopback::start_process_verified(pid, 0),
            Err(AudioError::InvalidProcess)
        ));
    }
}
