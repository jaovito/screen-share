#[cfg(all(feature = "native-proof", any(test, target_os = "windows")))]
mod arguments;
#[cfg(all(target_os = "windows", feature = "native-proof"))]
mod desktop_control;
#[cfg(any(test, all(target_os = "windows", feature = "native-proof")))]
mod input;
#[cfg(all(target_os = "windows", feature = "native-proof"))]
mod pipeline;
#[cfg(all(target_os = "windows", feature = "native-proof"))]
mod private_key;
#[cfg(all(target_os = "windows", feature = "native-proof"))]
mod windows_app;

fn main() {
    #[cfg(all(target_os = "windows", feature = "native-proof"))]
    if let Err(error) = if std::env::args_os()
        .skip(1)
        .eq([std::ffi::OsString::from("--desktop-control")])
    {
        desktop_control::run()
    } else {
        windows_app::run()
    } {
        eprintln!("{error}");
        std::process::exit(1);
    }
    #[cfg(not(all(target_os = "windows", feature = "native-proof")))]
    {
        eprintln!("This experimental publisher requires Windows 11 and the native-proof feature.");
        std::process::exit(1);
    }
}
