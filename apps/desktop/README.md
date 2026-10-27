# Windows desktop publisher

Tauri/React controls the real Rust WGC/D3D11/hardware-H.264 publisher. The browser preview can manage accounts/rooms but cannot capture. Native publishing targets Windows 11 x64 with MSVC, Windows SDK, WebView2 and a compatible GPU driver.

From the repository root, follow [local setup](../../README.md), then run `bun run dev:desktop`. The command builds the fixed native sidecar with two Cargo jobs before starting Tauri. `bun run build:desktop` creates an unsigned development NSIS installer containing the sidecar. Generated executables are ignored, never hand-authored or replaced with placeholders.

Create/sign into an account, prepare a private room session, distribute its fresh content key through an established encrypted channel and activate. Choose one of eight profiles and explicitly select a source in the Windows picker. Pause/resume retains that item. Slow adaptive quality respects the manual ceiling and Motion/Text preference. Source/driver/authorization failures stop explicitly; another source is never substituted.

Audio defaults off. Choose the specific application process tree or explicitly opt into the full system output mix; the latter can include voice calls. The separate audio choice does not infer a process from a window title. PID/creation-time validation and an owned handle pin the selected process. No failure enables a broader scope. Unplugged/exited sources require explicit action.

The renderer uses narrowly scoped custom IPC. Authentication cookies stay in a native in-memory jar, and the native child receives grants/keys only through private bounded pipes. No generic shell/filesystem/HTTP/updater permission exists. Native driver watchdogs terminate only the owned child. Signed lease renewal reauthenticates with the SFU while retaining the capture source; a new epoch requires a fresh key and explicit start.

Updates remain unavailable until a real updater public key and fixed HTTPS feed are compiled into the release. Checking/installing is user-triggered, signatures are verified with the official SDK and active publication must stop before installation/restart. See [release preparation](../../docs/releases.md); updater signatures are separate from Windows Authenticode.

The [M1 utility](../media-proof-native/README.md) and `?mode=experiment` preview remain for diagnostics. See [hardware acceptance](../../docs/m1-hardware-runbook.md) and [executed validation](../../docs/validation.md). macOS/Linux compilation does not validate Windows capture or establish a supported publisher on those platforms.
