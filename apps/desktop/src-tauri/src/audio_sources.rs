use serde::Serialize;

#[cfg(any(test, target_os = "windows"))]
const MAX_SOURCES: usize = 128;
#[cfg(any(test, target_os = "windows"))]
const MAX_LABEL_UNITS: usize = 256;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSource {
    process_id: u32,
    label: String,
    creation_time: String,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceState {
    #[cfg(target_os = "windows")]
    Ready,
    #[cfg(not(target_os = "windows"))]
    UnsupportedPlatform,
    #[cfg(target_os = "windows")]
    Unavailable,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSourcesResponse {
    state: SourceState,
    sources: Vec<AudioSource>,
}

// These labels stay in the local renderer. They are never diagnostics or API data.
#[cfg(any(test, target_os = "windows"))]
fn sanitize_label(raw: &[u16]) -> Option<String> {
    let bounded: Vec<_> = raw.iter().copied().take(MAX_LABEL_UNITS).collect();
    let label: String = String::from_utf16_lossy(&bounded)
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(*character, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .collect();
    let label = label.trim();
    (!label.is_empty()).then(|| label.to_owned())
}

#[tauri::command]
pub fn list_audio_sources() -> AudioSourcesResponse {
    #[cfg(target_os = "windows")]
    {
        match native::enumerate() {
            Some(sources) => AudioSourcesResponse {
                state: SourceState::Ready,
                sources,
            },
            None => AudioSourcesResponse {
                state: SourceState::Unavailable,
                sources: Vec::new(),
            },
        }
    }
    #[cfg(not(target_os = "windows"))]
    AudioSourcesResponse {
        state: SourceState::UnsupportedPlatform,
        sources: Vec::new(),
    }
}

#[cfg(target_os = "windows")]
mod native {
    use super::{AudioSource, MAX_LABEL_UNITS, MAX_SOURCES, sanitize_label};
    use std::collections::HashSet;
    use windows::Win32::{
        Foundation::{CloseHandle, FILETIME, HANDLE, HWND, LPARAM},
        System::Threading::{
            GetCurrentProcessId, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GWL_EXSTYLE, GetWindowLongPtrW, GetWindowTextW, GetWindowThreadProcessId,
            IsWindowVisible, WS_EX_TOOLWINDOW,
        },
    };
    use windows::core::BOOL;

    struct Process(HANDLE);
    impl Drop for Process {
        fn drop(&mut self) {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    struct Enumeration {
        sources: Vec<AudioSource>,
        seen: HashSet<u32>,
        visited: usize,
        bounded: bool,
    }

    fn creation_time(pid: u32) -> Option<String> {
        let process =
            Process(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?);
        let (mut created, mut exited, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        unsafe { GetProcessTimes(process.0, &mut created, &mut exited, &mut kernel, &mut user) }
            .ok()?;
        let value = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
        (value > 0).then(|| value.to_string())
    }

    unsafe extern "system" fn visit(window: HWND, parameter: LPARAM) -> BOOL {
        // EnumWindows invokes this callback synchronously; the caller retains this
        // stack-owned context for the entire call and never exposes its pointer.
        let context = unsafe { &mut *(parameter.0 as *mut Enumeration) };
        if context.sources.len() >= MAX_SOURCES || context.visited >= 4096 {
            context.bounded = true;
            return BOOL(0);
        }
        context.visited += 1;
        if !unsafe { IsWindowVisible(window) }.as_bool()
            || unsafe { GetWindowLongPtrW(window, GWL_EXSTYLE) } & WS_EX_TOOLWINDOW.0 as isize != 0
        {
            return BOOL(1);
        }
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
        if pid == 0 || pid == unsafe { GetCurrentProcessId() } || context.seen.contains(&pid) {
            return BOOL(1);
        }
        let mut text = [0u16; MAX_LABEL_UNITS + 1];
        // Cross-process GetWindowText reads the OS caption; it does not send an
        // arbitrary window-message request to a possibly unresponsive program.
        let count = unsafe { GetWindowTextW(window, &mut text) };
        if count <= 0 {
            return BOOL(1);
        }
        let Some(label) = sanitize_label(&text[..count as usize]) else {
            return BOOL(1);
        };
        let Some(creation_time) = creation_time(pid) else {
            return BOOL(1);
        };
        context.seen.insert(pid);
        context.sources.push(AudioSource {
            process_id: pid,
            label,
            creation_time,
        });
        BOOL(1)
    }

    pub fn enumerate() -> Option<Vec<AudioSource>> {
        let mut context = Enumeration {
            sources: Vec::new(),
            seen: HashSet::new(),
            visited: 0,
            bounded: false,
        };
        let result = unsafe {
            EnumWindows(
                Some(visit),
                LPARAM((&mut context as *mut Enumeration) as isize),
            )
        };
        if result.is_err() && !context.bounded {
            return None;
        }
        context.sources.sort_by(|left, right| {
            left.label
                .cmp(&right.label)
                .then(left.process_id.cmp(&right.process_id))
        });
        Some(context.sources)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_bounded_safe_unicode_without_controls_or_bidi_override() {
        assert_eq!(sanitize_label(&[]), None);
        assert_eq!(sanitize_label(&[0, 9, 10]), None);
        let raw: Vec<_> = "  Synthetic\n\u{202e} player  ".encode_utf16().collect();
        assert_eq!(sanitize_label(&raw).as_deref(), Some("Synthetic player"));
        let raw: Vec<_> = "🎮".repeat(300).encode_utf16().collect();
        let label = sanitize_label(&raw).unwrap();
        assert!(label.encode_utf16().count() <= MAX_LABEL_UNITS);
        assert_eq!(sanitize_label(&[0xd800]).unwrap(), "\u{fffd}");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn unsupported_platforms_do_not_invent_process_choices() {
        let result = list_audio_sources();
        assert!(matches!(result.state, SourceState::UnsupportedPlatform));
        assert!(result.sources.is_empty());
        assert_eq!(MAX_SOURCES, 128);
    }
}
