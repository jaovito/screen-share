//! Private, explicitly requested Windows key export. No credentials are logged.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ss_rtc_livekit::native_proof::MediaKey;
use std::ffi::{OsString, c_void};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Component, Path, Prefix};
use windows::{
    Win32::{
        Foundation::{
            CloseHandle, ERROR_INSUFFICIENT_BUFFER, GENERIC_WRITE, HANDLE, HLOCAL, LocalFree,
        },
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SDDL_REVISION_1,
            },
            Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom},
            GetTokenInformation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
            TOKEN_USER, TokenUser,
        },
        Storage::FileSystem::{
            CREATE_NEW, CreateFileW, DELETE, FILE_ATTRIBUTE_TEMPORARY, FILE_FLAG_DELETE_ON_CLOSE,
            FILE_NAME_NORMALIZED, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_TYPE_DISK,
            FlushFileBuffers, GetFileType, GetFinalPathNameByHandleW,
            GetVolumeInformationByHandleW, WriteFile,
        },
        System::{
            SystemServices::FILE_PERSISTENT_ACLS,
            Threading::{GetCurrentProcess, OpenProcessToken},
        },
    },
    core::{HRESULT, PCWSTR, PWSTR},
};

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // This value owns exactly one successful Win32 handle acquisition.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}

struct LocalBuffer(*mut c_void);

impl Drop for LocalBuffer {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SID strings and converted security descriptors use LocalAlloc.
            let _ = unsafe { LocalFree(Some(HLOCAL(self.0))) };
        }
    }
}

/// Keep this guard on its owner thread until publication and manual distribution
/// finish. Closing it deletes the file; Windows also closes it after process exit.
/// No Clone, Debug, serialization, or unsafe Send implementation is provided.
pub struct KeyFile {
    _file: OwnedHandle,
}

pub fn generate_and_export(path: &Path) -> Result<(MediaKey, KeyFile), &'static str> {
    let filename = local_filename(path)?;
    let descriptor = current_user_descriptor()?;
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: false.into(),
    };
    // CREATE_NEW refuses existing files. The protected descriptor prevents
    // inheriting a broader parent DACL; delete-on-close covers error/crash paths.
    let file = OwnedHandle(
        unsafe {
            CreateFileW(
                PCWSTR(filename.as_ptr()),
                GENERIC_WRITE.0 | DELETE.0,
                FILE_SHARE_READ | FILE_SHARE_DELETE,
                Some(&attributes),
                CREATE_NEW,
                FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE,
                None,
            )
        }
        .map_err(|_| "Cannot create the private key file. Use a new local file path.")?,
    );

    let mut resolved = vec![0u16; 32_768];
    let length =
        unsafe { GetFinalPathNameByHandleW(file.0, &mut resolved, FILE_NAME_NORMALIZED) } as usize;
    if length == 0 || length >= resolved.len() {
        return Err("Cannot establish the private key file location.");
    }
    // A local-looking parent symlink may resolve to a remote share. Check the
    // opened object itself before generating or writing any key material.
    let resolved = OsString::from_wide(&resolved[..length]);
    local_filename(Path::new(&resolved))?;

    let mut filesystem_flags = 0;
    // Never write a secret to a volume that cannot enforce its per-file DACL.
    if unsafe { GetFileType(file.0) } != FILE_TYPE_DISK
        || unsafe {
            GetVolumeInformationByHandleW(
                file.0,
                None,
                None,
                None,
                Some(&mut filesystem_flags),
                None,
            )
        }
        .is_err()
        || filesystem_flags & FILE_PERSISTENT_ACLS == 0
    {
        return Err("The private key requires a local volume with persistent Windows ACLs.");
    }

    let mut random = [0u8; 32];
    // BCrypt's system-preferred provider supplies cryptographic randomness.
    if unsafe { BCryptGenRandom(None, &mut random, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.0 != 0 {
        return Err("Secure media key generation failed.");
    }
    let encoded = URL_SAFE_NO_PAD.encode(random);
    random.fill(0);
    let media_key = MediaKey::from_encoded_secret(&encoded)
        .map_err(|_| "Generated media key validation failed.")?;
    let mut remaining = encoded.as_bytes();

    while !remaining.is_empty() {
        let mut written = 0;
        unsafe { WriteFile(file.0, Some(remaining), Some(&mut written), None) }
            .map_err(|_| "Private media key export failed.")?;
        let written = written as usize;
        if written == 0 || written > remaining.len() {
            return Err("Private media key export failed.");
        }
        remaining = &remaining[written..];
    }
    unsafe { FlushFileBuffers(file.0) }.map_err(|_| "Private media key flush failed.")?;

    Ok((media_key, KeyFile { _file: file }))
}

fn local_filename(path: &Path) -> Result<Vec<u16>, &'static str> {
    // Named pipes/devices, UNC shares, and alternate data streams do not provide
    // the intended new local file/DACL contract. Parent reparses cannot bypass
    // the DACL supplied atomically for the newly created leaf object.
    if !path.is_absolute()
        || !matches!(
            path.components().next(),
            Some(Component::Prefix(prefix))
                if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        )
        || path.components().any(|part| {
            matches!(part, Component::Normal(value) if value.encode_wide().any(|unit| unit == u16::from(b':')))
        })
    {
        return Err("Choose an absolute local drive path without an alternate data stream.");
    }
    let mut filename: Vec<u16> = path.as_os_str().encode_wide().collect();
    if filename.contains(&0) {
        return Err("The private key path is invalid.");
    }
    filename.push(0);
    Ok(filename)
}

fn current_user_descriptor() -> Result<LocalBuffer, &'static str> {
    let mut token = OwnedHandle(HANDLE::default());
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token.0) }
        .map_err(|_| "Cannot inspect the current Windows identity.")?;
    let mut required = 0;
    let sizing = unsafe { GetTokenInformation(token.0, TokenUser, None, 0, &mut required) };
    if !matches!(sizing, Err(error) if error.code() == HRESULT::from_win32(ERROR_INSUFFICIENT_BUFFER.0))
        || required < std::mem::size_of::<TOKEN_USER>() as u32
        || required > 65_536
    {
        return Err("Cannot inspect the current Windows identity.");
    }

    // TOKEN_USER begins with a pointer-aligned structure. usize storage provides
    // that alignment while retaining room for the trailing variable-size SID.
    let words = (required as usize).div_ceil(std::mem::size_of::<usize>());
    let mut information = vec![0usize; words];
    let mut returned = 0;
    unsafe {
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(information.as_mut_ptr().cast()),
            required,
            &mut returned,
        )
    }
    .map_err(|_| "Cannot inspect the current Windows identity.")?;
    if returned < std::mem::size_of::<TOKEN_USER>() as u32 || returned > required {
        return Err("Cannot inspect the current Windows identity.");
    }
    // The successful query initialized TOKEN_USER and its SID in this live,
    // correctly aligned buffer. The OS owns the token data format.
    let user = unsafe { &*information.as_ptr().cast::<TOKEN_USER>() };
    let mut sid_string = PWSTR::null();
    let converted = unsafe { ConvertSidToStringSidW(user.User.Sid, &mut sid_string) };
    let _sid_buffer = LocalBuffer(sid_string.0.cast());
    converted.map_err(|_| "Cannot protect the private media key.")?;
    let sid =
        unsafe { sid_string.to_string() }.map_err(|_| "Cannot protect the private media key.")?;
    let sddl: Vec<u16> = format!("D:P(A;;FA;;;{sid})")
        .encode_utf16()
        .chain([0])
        .collect();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl.as_ptr()),
            SDDL_REVISION_1,
            &mut descriptor,
            None,
        )
    };
    let descriptor = LocalBuffer(descriptor.0);
    converted.map_err(|_| "Cannot protect the private media key.")?;
    if descriptor.0.is_null() {
        return Err("Cannot protect the private media key.");
    }
    Ok(descriptor)
}

#[cfg(test)]
mod tests;
