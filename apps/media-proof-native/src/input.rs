use std::{fs::File, io::Read, path::Path};

const MAX_GRANT_BYTES: u64 = 12_000;

pub fn read_grant(path: &Path) -> Result<String, &'static str> {
    let file = File::open(path).map_err(|_| "Publisher grant unavailable")?;
    if !file
        .metadata()
        .map_err(|_| "Publisher grant unavailable")?
        .is_file()
    {
        return Err("Publisher grant must be a regular file");
    }
    let mut json = String::new();
    file.take(MAX_GRANT_BYTES + 1)
        .read_to_string(&mut json)
        .map_err(|_| "Publisher grant must be bounded UTF-8")?;
    if json.len() as u64 > MAX_GRANT_BYTES {
        return Err("Publisher grant too large");
    }
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn reads_only_bounded_regular_utf8_grants() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("valid test clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "ss-grant-input-{}-{stamp}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).expect("owned test directory");
        let result = std::panic::catch_unwind(|| {
            let file = directory.join("grant.json");
            fs::write(&file, "{}".repeat(6000)).expect("synthetic exact-bound input");
            assert_eq!(
                read_grant(&file).expect("exact limit accepted").len(),
                12000
            );
            fs::write(&file, "x".repeat(12001)).expect("synthetic oversized input");
            assert!(read_grant(&file).is_err());
            fs::write(&file, [255_u8]).expect("synthetic invalid UTF-8");
            assert!(read_grant(&file).is_err());
            assert!(read_grant(&directory).is_err());
            assert!(read_grant(&directory.join("missing")).is_err());
        });
        fs::remove_dir_all(&directory).expect("owned test cleanup");
        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
    }
}
