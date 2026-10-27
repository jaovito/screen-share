# M1 media proof

The first M1 increment provides a real opt-in encrypted browser receiver, offline operator grants, portable session/queue/access-unit rules, and a Windows WGC capture primitive. The default desktop shell still cannot publish. The separate opt-in [native publisher proof](../apps/media-proof-native/README.md) composes WGC, GPU conversion, hardware Media Foundation H.264, and native encrypted transport/feedback; its complete Windows runtime/hardware/two-PC execution remains unverified. M1 and the product are not complete.

See [ADR 0011](adr/0011-media-proof-boundaries.md) and [SDK evidence](m1-sdk-research.md). Do not expose the M0 local Compose stack to a network to work around missing infrastructure/authentication.

## Offline operator grants

This command is for a trusted local experiment operator who has already verified the participants out of band. It is not login, invitation acceptance, or a remotely callable authorization service. Use opaque UUIDs, not names/emails. Review this example and replace its synthetic identities with the experiment's independently authorized identities:

```json
{
  "sessionId": "83c97c34-e315-43ea-8bcf-bcb90d03f9db",
  "epoch": 1,
  "participants": [
    { "id": "d8b61e1e-d5c7-4de4-90eb-a825481aabec", "role": "publisher" },
    { "id": "fe15d838-70a2-4fda-b38c-40c7a5e98ec2", "role": "viewer" }
  ]
}
```

Save the reviewed plan locally. With the existing ignored `.env` containing the SFU signing credentials, set `LIVEKIT_PUBLIC_URL` to the authorized client signaling address. Use WSS; unencrypted WS is accepted only on loopback for same-machine tests. The address must contain no username, password, query, or fragment. No credential belongs in a VITE variable.

```sh
mkdir -p .media-proof
bun run media:grants --authorized-plan .media-proof/authorized-plan.json .media-proof/run-1
```

`LIVEKIT_PUBLIC_URL=ws://127.0.0.1:7880` is the local-only example. Add it to ignored local configuration if bootstrap predates this experiment. Existing configuration is preserved. Each invocation needs a new destination and creates a new random RTC room; logical session ID/epoch metadata does not enforce server-side epochs.

Deliver each participant only their own JSON file over an authenticated encrypted channel. Grants expire after five minutes. The publisher can publish screen-share video only; viewers cannot publish. No camera, microphone, audio, data, room administration, or recording permissions are issued. Unix permissions are 0700 for the new directory and 0600 for files; on Windows apply the appropriate user-only directory ACL. Generated files are ignored under `.media-proof/` and must never be committed or pasted into issues/logs. The command refuses to overwrite existing destinations.

The publishing client must generate a fresh 32-byte cryptographically random media secret, encode it as a 43-character unpadded base64url string, and pass that exact string to its SDK. Distribute it separately to authorized viewers using an established E2EE channel. Neither the operator nor control API should receive the media key. A grant JWT is not a media key. The separate native proof client generates/exports its own key locally; the default Tauri shell does not expose that functionality.

## Browser experiment

Run the normal viewer, expand **M1 · Experimental encrypted receiver**, paste your viewer JSON and independently supplied media key, explicitly consent, then connect. UI copy follows pt-BR/es/en. Credentials are held in memory and cleared from the form; JavaScript does not provide a memory-zeroization guarantee. A secure browser context and E2EE support are required. The receiver never requests camera, microphone, or screen capture.

The client verifies the room/local participant after connection, then requests only one encrypted screen-share video from the designated publisher. The status distinguishes connection/subscription from actual decoded playback. Unexpected tracks/identity, expiry, encryption or connection failure, and reconnect attempts stop the experiment. Disconnect, collapsing the panel, or leaving the page releases owned media/worker resources. Another connection requires an explicit action and current grant/key. There is no plaintext fallback.

## Disposable transport regression

Prerequisites: pinned Bun, running Docker with a host-routable private container interface (validated on Linux hosts and macOS/OrbStack), installed Playwright Chromium (`bun run test:e2e:install`). Run:

```sh
bun run test:media
```

The runner owns a temporary LiveKit configuration/container, fresh ports, test-only synthetic credentials, two browser builds, and one Chromium worker. The SFU is limited to one CPU/256 MiB. Builds run sequentially. It uses three pages: a synthetic publisher, a correct-key viewer, and a wrong-key viewer. There is no camera, microphone, desktop capture, recording, or personal content. Container, temporary signing configuration, and publisher build are removed on success/failure; normal development services/volumes are untouched. It requires loopback network access.

The actual worker must receive/decode multiple synthetic H.264 frames with the correct key. The wrong-key client must decode none while the correct client continues. This guards actual worker/build/transport behavior that mocks cannot cover. It does not replace two-PC/native interoperability or establish native hardware performance.

## Windows acquisition boundary

The target-specific `ss-media-windows` acquisition API uses `windows = 0.62.2`. `pick_source(HWND)` requires an initialized owning WinRT/UI apartment and a live top-level window/message loop. It shows the system picker without starting capture. After separate authorization/encryption checks, trusted native composition may consume that exact `PickedSource` with `NativeCapture::start`.

Frames remain owned D3D11 textures in a one-pending-frame queue. WGC has two acquisition buffers; each delivered texture currently requires one GPU copy/allocation. There is no CPU readback or zero-copy claim. The path requests SDR BGRA, bounds individual surfaces to 8192 pixels per dimension and 3840×2160 total area, and does not implement HDR tone mapping. Consumers must not accumulate taken frames. Resizing preserves the capture item; closing it stops the source. The owner must observe capture status and stop/release resources promptly on failure.

Host cross-check, after installing the Windows standard-library target:

```sh
CARGO_BUILD_JOBS=2 cargo clippy --locked -p ss-media-windows --target x86_64-pc-windows-msvc --all-targets -- -D warnings
```

This checks API/type compatibility without linking/executing Windows capture. The desktop does not expose this primitive through IPC yet. The system-picker and hardware diagnostics are explicit Windows commands:

```sh
cargo run -p ss-media-windows --features probe-ui --example capture_probe -- --seconds 10
cargo run -p ss-media-windows --features probe-ui --example encoder_probe -- --seconds 10 --height 1080 --fps 60
```

The encoder diagnostic keeps consent/acquisition on STA and hardware processing on an MTA worker, counts actual encoded output, requests a keyframe and declared halfway bitrate change, fails if no encoded units arrive, and uses an own-process watchdog. It saves/transmits no content. These commands have not been executed on this macOS host. Do not describe it as a functioning desktop screen-sharing feature.

## Remaining M1 gate

Execute and validate the implemented hardware converter/encoder and native encrypted transport composition on Windows, then complete the PLAN.md two-PC/hardware protocol and integrate the regular product shell without weakening permissions. Required evidence includes the same selected window after resize/Alt+Tab/minimization/recovery, source closure without fallback, key mismatch rejection across Rust/JS, applied bitrate/keyframe feedback, bounded resource growth, and measured encoding/game/network/playback behavior. Until then, M2–M5 are pending rather than implicitly delivered.


## Rust-to-browser transport regression

`bun run test:media:native` enables the optional `ss-rtc-livekit/native-proof` SDK and runs a Rust publisher against the actual browser encryption worker/decoder. A browser fixture generates bounded synthetic 854×480 H.264 Annex B samples through WebCodecs and downloads a temporary binary fixture; no frames pass through JSON or the product API. The Rust executable publishes those pre-encoded units with its independent media key. A correct-key browser must decode motion while a wrong-key browser decodes none. Its two-job compilation and one browser worker are serial; this does not use WGC, Media Foundation, or a hardware encoder.

Executed on macOS arm64 with OrbStack. Native WebRTC ignores loopback interfaces by default, and forced-loopback browser RTC also failed intermittently/under Linux CI. Both fixtures therefore let their own SFU advertise the private container interface while all published ports/signaling stay bound to 127.0.0.1. A bounded preflight rejects runtimes without host-routable private container IPs. It does not open LAN listeners or patch the SDK. Standard Docker Desktop routing may not support this optional fixture. On macOS the test executable alone receives the SDK-required `-ObjC` linker flag. Windows SDK builds require its static CRT flag. See [SDK build guidance](https://github.com/livekit/rust-sdks#building) and [OrbStack private container access](https://docs.orbstack.dev/docker/network#direct-container-access).

The test establishes interoperability of the selected native/browser SDKs with synthetic pre-encoded H.264 and matching string-key derivation. It is not two-PC proof, a malicious-SFU assessment, native GPU encoding evidence, or a performance benchmark. Actual hardware and prolonged tests remain mandatory.
