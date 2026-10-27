use super::*;
use std::fs::{self, File};
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use windows::Win32::{
    Security::{
        ACCESS_ALLOWED_ACE, ACL_SIZE_INFORMATION, AclSizeInformation,
        Authorization::{GetSecurityInfo, SE_FILE_OBJECT},
        DACL_SECURITY_INFORMATION, EqualSid, GetAce, GetAclInformation,
        GetSecurityDescriptorControl, PSID, SE_DACL_PROTECTED,
    },
    Storage::FileSystem::FILE_ALL_ACCESS,
    System::SystemServices::ACCESS_ALLOWED_ACE_TYPE,
};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let suffix = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ss-private-key-test-{}-{nonce}-{suffix}",
            std::process::id()
        ));
        fs::create_dir(&path).expect("create exclusively owned test directory");
        Self(path)
    }

    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        // Only remove explicit test-owned children; never traverse another tree.
        for name in ["first.key", "second.key", "existing.key"] {
            let _ = fs::remove_file(self.file(name));
        }
        let _ = fs::remove_dir(&self.0);
    }
}

fn has_key_shape(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|decoded| decoded.len() == 32)
}

fn assert_current_user_only_acl(file: &KeyFile) {
    let mut dacl = std::ptr::null_mut();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // Read the actual file object security descriptor, independently of the
    // SDDL construction used by the implementation.
    let status = unsafe {
        GetSecurityInfo(
            file._file.0,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(&mut dacl),
            None,
            Some(&mut descriptor),
        )
    };
    let _descriptor_owner = LocalBuffer(descriptor.0);
    assert_eq!(status.0, 0, "read actual private file ACL");
    assert!(!descriptor.0.is_null());
    assert!(!dacl.is_null());
    let mut control = 0;
    let mut revision = 0;
    assert!(
        unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) }.is_ok()
    );
    assert!(control & SE_DACL_PROTECTED.0 != 0);

    let mut information = ACL_SIZE_INFORMATION::default();
    assert!(
        unsafe {
            GetAclInformation(
                dacl,
                (&mut information as *mut ACL_SIZE_INFORMATION).cast(),
                std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
                AclSizeInformation,
            )
        }
        .is_ok()
    );
    assert_eq!(information.AceCount, 1);
    let mut entry = std::ptr::null_mut();
    assert!(unsafe { GetAce(dacl, 0, &mut entry) }.is_ok());
    assert!(!entry.is_null());
    // GetAce returns a Win32-aligned ACE within the descriptor owned above.
    let entry = unsafe { &*entry.cast::<ACCESS_ALLOWED_ACE>() };
    assert_eq!(u32::from(entry.Header.AceType), ACCESS_ALLOWED_ACE_TYPE);
    assert_eq!(entry.Header.AceFlags, 0);
    assert_eq!(entry.Mask, FILE_ALL_ACCESS.0);
    assert!(usize::from(entry.Header.AceSize) >= std::mem::size_of::<ACCESS_ALLOWED_ACE>());

    let mut token = OwnedHandle(HANDLE::default());
    assert!(unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token.0) }.is_ok());
    // A TOKEN_USER header plus Windows' maximum SID size fits well within this
    // independent fixed, pointer-aligned query buffer. No SID is printed.
    let mut token_information = [0usize; 128];
    let mut returned = 0;
    assert!(
        unsafe {
            GetTokenInformation(
                token.0,
                TokenUser,
                Some(token_information.as_mut_ptr().cast()),
                std::mem::size_of_val(&token_information) as u32,
                &mut returned,
            )
        }
        .is_ok()
    );
    assert!(returned as usize >= std::mem::size_of::<TOKEN_USER>());
    assert!(returned as usize <= std::mem::size_of_val(&token_information));
    let current_user = unsafe { &*token_information.as_ptr().cast::<TOKEN_USER>() };
    let allowed_sid = PSID(std::ptr::addr_of!(entry.SidStart).cast_mut().cast());
    assert!(unsafe { EqualSid(allowed_sid, current_user.User.Sid) }.is_ok());
}

#[test]
fn generates_independent_private_keys_and_preserves_existing_file_contents() {
    let directory = TestDirectory::new();
    let first_path = directory.file("first.key");
    let second_path = directory.file("second.key");
    let (_first_media, first_file) =
        generate_and_export(&first_path).expect("first private export");
    let (_second_media, second_file) =
        generate_and_export(&second_path).expect("second private export");
    let first = fs::read_to_string(&first_path).expect("read first synthetic private export");
    let second = fs::read_to_string(&second_path).expect("read second synthetic private export");
    assert!(has_key_shape(&first));
    assert!(has_key_shape(&second));
    // Boolean assertions prevent the test runner from displaying actual keys.
    assert!(first != second, "independent key generations must differ");
    assert_current_user_only_acl(&first_file);
    assert_current_user_only_acl(&second_file);
    assert!(generate_and_export(&first_path).is_err());
    let preserved = fs::read_to_string(&first_path).expect("read preserved synthetic export");
    assert!(
        preserved == first,
        "an existing key export must remain unchanged"
    );
    drop(first_file);
    drop(second_file);
    assert!(!first_path.exists());
    assert!(!second_path.exists());
}

#[test]
fn deletes_the_owned_key_after_the_last_reader_closes() {
    let directory = TestDirectory::new();
    let path = directory.file("first.key");
    let (_media_key, owner) = generate_and_export(&path).expect("private export");
    // Rust's Windows file reader shares delete access, as required by the
    // delete-on-close owner. The reader keeps the object alive until it closes.
    let mut reader = File::open(&path).expect("open explicit synthetic key reader");
    drop(owner);
    let mut contents = String::new();
    reader
        .read_to_string(&mut contents)
        .expect("read existing handle after owner closes");
    assert!(has_key_shape(&contents));
    drop(reader);
    assert!(!path.exists());
}

#[test]
fn rejects_existing_non_key_files_relative_paths_remote_paths_devices_and_streams() {
    let directory = TestDirectory::new();
    let existing = directory.file("existing.key");
    fs::write(&existing, b"synthetic-existing-file").expect("owned existing fixture");
    assert!(generate_and_export(&existing).is_err());
    let contents = fs::read(&existing).expect("read original owned fixture");
    assert!(contents == b"synthetic-existing-file");
    let stream_path = PathBuf::from(format!("{}:media-key", existing.display()));
    assert!(generate_and_export(&stream_path).is_err());
    assert!(!stream_path.exists());
    for invalid in [
        Path::new("relative-key-file"),
        Path::new(r"\\127.0.0.1\unavailable-share\key"),
        Path::new(r"\\?\UNC\127.0.0.1\unavailable-share\key"),
        Path::new(r"\\.\pipe\synthetic-private-key"),
        Path::new("C:\\invalid\0key"),
    ] {
        assert!(generate_and_export(invalid).is_err());
    }
}
