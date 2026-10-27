use std::{
    future::Future,
    marker::PhantomData,
    pin::pin,
    rc::Rc,
    task::{Context, Poll, Waker},
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::{
            LibraryLoader::GetModuleHandleW,
            WinRT::{RO_INIT_SINGLETHREADED, RoInitialize, RoUninitialize},
        },
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, IsWindow, MSG,
            PM_REMOVE, PeekMessageW, PostQuitMessage, RegisterClassW, TranslateMessage,
            UnregisterClassW, WINDOW_EX_STYLE, WM_DESTROY, WM_QUIT, WNDCLASSW, WS_OVERLAPPEDWINDOW,
            WS_VISIBLE,
        },
    },
    core::w,
};

/// An explicitly launched, STA-owned diagnostic window. No source titles are read.
pub struct ProbeWindow {
    pub handle: HWND,
    _apartment: PhantomData<Rc<()>>,
}

impl ProbeWindow {
    pub fn open() -> Result<Self, &'static str> {
        unsafe { RoInitialize(RO_INIT_SINGLETHREADED) }
            .map_err(|_| "WinRT initialization failed")?;
        let result = Self::create();
        if result.is_err() {
            unsafe { RoUninitialize() };
        }
        result
    }

    fn create() -> Result<Self, &'static str> {
        let instance =
            unsafe { GetModuleHandleW(None) }.map_err(|_| "Module handle unavailable")?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            lpszClassName: w!("ScreenShareCaptureProbe"),
            ..Default::default()
        };
        if unsafe { RegisterClassW(&class) } == 0 {
            return Err("Diagnostic window registration failed");
        }
        let handle = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                class.lpszClassName,
                w!("Screen Share M1 probe - close to stop"),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                100,
                100,
                520,
                160,
                None,
                None,
                Some(instance.into()),
                None,
            )
        }
        .map_err(|_| "Diagnostic window creation failed")?;
        Ok(Self {
            handle,
            _apartment: PhantomData,
        })
    }

    /// Polls only on the owning thread while continuing the Windows message loop.
    pub fn wait<F: Future>(&self, future: F) -> Result<F::Output, &'static str> {
        let mut future = pin!(future);
        let mut context = Context::from_waker(Waker::noop());
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            if !self.pump() {
                return Err("Selection canceled by closing the probe");
            }
            if let Poll::Ready(result) = future.as_mut().poll(&mut context) {
                return Ok(result);
            }
            if Instant::now() >= deadline {
                return Err("Selection timed out");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub fn pump(&self) -> bool {
        let mut message = MSG::default();
        // Bound work per poll even if the window receives a continuous message stream.
        for _ in 0..100 {
            if !unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
                break;
            }
            if message.message == WM_QUIT {
                return false;
            }
            unsafe {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        unsafe { IsWindow(Some(self.handle)) }.as_bool()
    }
}

impl Drop for ProbeWindow {
    fn drop(&mut self) {
        unsafe {
            if IsWindow(Some(self.handle)).as_bool() {
                let _ = DestroyWindow(self.handle);
            }
            if let Ok(instance) = GetModuleHandleW(None) {
                let _ = UnregisterClassW(w!("ScreenShareCaptureProbe"), Some(instance.into()));
            }
            RoUninitialize();
        }
    }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_DESTROY {
        unsafe { PostQuitMessage(0) };
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

/// Force termination is reserved for this explicitly launched diagnostic process.
/// It bypasses user-mode DLL teardown, which can itself hang after a driver fault.
pub fn terminate_probe() -> ! {
    use windows::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};
    let _ = unsafe { TerminateProcess(GetCurrentProcess(), 2) };
    std::process::abort()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };

    #[test]
    fn terminates_only_the_owned_stalled_probe_process() {
        if std::env::var_os("SS_PROBE_TEST_FORCE_EXIT").is_some() {
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_millis(100));
                terminate_probe();
            });
            loop {
                std::thread::park();
            }
        }
        let mut child = Command::new(std::env::current_exe().expect("test executable"))
            .arg("--exact")
            .arg("probe_window::tests::terminates_only_the_owned_stalled_probe_process")
            .env("SS_PROBE_TEST_FORCE_EXIT", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("owned test process");
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = child.try_wait().expect("owned process status") {
                assert_eq!(status.code(), Some(2));
                break;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("Own-process watchdog did not terminate the stalled test child");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
