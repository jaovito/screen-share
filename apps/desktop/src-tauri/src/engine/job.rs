use std::{
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    process::Child,
};
use windows::Win32::{
    Foundation::HANDLE,
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    },
};

/// The kernel terminates only the owned engine tree if the desktop exits/crashes.
/// OwnedHandle supplies Send/Sync safely; no raw-handle ownership is duplicated.
pub(super) struct Job {
    _handle: OwnedHandle,
}

impl Job {
    pub fn own(child: &Child) -> Result<Self, &'static str> {
        let handle =
            unsafe { CreateJobObjectW(None, None) }.map_err(|_| "engine_isolation_failed")?;
        let owned = unsafe { OwnedHandle::from_raw_handle(handle.0) };
        let mut information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&information as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .map_err(|_| "engine_isolation_failed")?;
            AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle()))
                .map_err(|_| "engine_isolation_failed")?;
        }
        Ok(Self { _handle: owned })
    }
}
