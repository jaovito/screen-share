# M1 SDK and native media research

Reviewed on 2026-10-26. This document distinguishes SDK capabilities from executed product evidence. It does not complete the M1 Windows/two-PC advancement gate.

## Selected receiver API

The browser proof uses pinned livekit-client 2.23.0. The production receiver creates a local E2EE worker, configures `Room` through `encryption`, installs an independently distributed string key, and enables encryption before attempting connection. It never acquires camera, microphone, or screen media. Subscription is manual and limited to one encrypted screen-share video from the designated publisher.

The opt-in form accepts a five-minute operator-issued viewer envelope and media key. Form values are cleared on submission; neither is written to storage or URLs. The locale preference is application-managed persisted state. The SDK may persist non-secret logging preferences; neither grant nor media key is stored by this flow. The receiver verifies the connected room and local participant before subscribing. Reconnect, identity mismatch, unexpected tracks, encryption errors, expiry, and timeouts stop reception and require another explicit action. A subscribed track is not a claim that frames have decoded or that the privacy model has been independently verified.

Official sources:

- [LiveKit encryption setup](https://docs.livekit.io/transport/encryption/start/).
- [JavaScript key provider](https://github.com/livekit/client-sdk-js/blob/main/src/e2ee/KeyProvider.ts).
- [JavaScript key derivation](https://github.com/livekit/client-sdk-js/blob/main/src/e2ee/utils.ts).

## Cross-SDK key material

JavaScript string key material uses PBKDF2; an ArrayBuffer selects HKDF. The Rust shared-key provider defaults to PBKDF2. For the initial interoperability proof, pass the same high-entropy base64url string as a JavaScript string and as UTF-8 bytes to the native provider, with matching default salt and shared index zero. Do not base64-decode only one side. The grant token and media key serve different purposes; the operator does not generate or receive the media key.

[Native key-provider implementation](https://github.com/livekit/rust-sdks/blob/main/livekit/src/room/e2ee/key_provider.rs) is research evidence; confirm signatures again against the selected pinned native crate before integration.

## Native publication candidate

Published Rust candidate: livekit 0.9.7. The opt-in native-proof adapter now uses this version; compilation/runtime evidence is recorded separately in validation.md. Its pre-encoded source API accepts externally encoded access units and exposes keyframe/rate-control feedback. The hardware encoder must honor that feedback. H.264 publication requires complete access units, capture timestamps, and decoder initialization data with keyframes. One source provides one spatial layer; disable simulcast rather than claiming per-viewer quality layers.

- [Published Rust SDK release](https://docs.rs/crate/livekit/0.9.7).
- [Official pre-encoded publication contract](https://docs.livekit.io/transport/media/pre-encoded/).

The preview livekit-capture helper is optional and is not evidence of a ready Windows hardware encoder. Its preview status should be evaluated before adopting another abstraction.

## Windows implementation boundary

Use the Windows system capture picker only after explicit selection. A free-threaded WGC frame pool delivers frames off the UI thread. Borrowed frame surfaces must not outlive the capture frame; copy the selected content region into owned bounded textures and return the frame promptly. Preserve the same capture item during resize or recovery. HDR needs an explicit format/tone-mapping decision before support is claimed.

- [Microsoft capture API and frame lifetime](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture).
- [Free-threaded frame pool](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.direct3d11captureframepool.createfreethreaded).

A D3D11 processing stage must scale/convert selected BGRA content into the encoder's accepted format. Enumerate hardware H.264 MFTs explicitly; a Microsoft H.264 encoder instance alone does not establish hardware acceleration. Hardware MFTs process asynchronously and require an event-driven input/output pump, bounded samples, device lifecycle handling, and cleanup. Validate latency, B-frame configuration, bitrate changes, and keyframe requests on the actual driver.

- [Hardware transform requirements](https://learn.microsoft.com/en-us/windows/win32/medfound/hardware-mfts).
- [Hardware enumeration flags and allocation ownership](https://learn.microsoft.com/en-us/windows/win32/api/mfapi/nf-mfapi-mftenumex).
- [H.264 encoder configuration](https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder).
- [Published Microsoft Rust projection candidate, windows 0.62.2](https://docs.rs/crate/windows/0.62.2).

## Unexecuted advancement checks

Windows WGC/D3D11/Media Foundation execution, hardware encoder selection, two-PC playback, hardware congestion feedback, source preservation, Alt+Tab recovery, and measured process/GPU overhead require real hardware evidence. Native-to-browser key compatibility and wrong-key rejection have an actual synthetic local transport regression; this is separate from the hardware/two-PC gate. Browser mocks and a healthy SFU cannot establish those results. See PLAN.md and docs/validation.md for the current implemented and measured state.


## Opt-in native transport adapter

The `ss-rtc-livekit/native-proof` feature implements the pinned pre-encoded SDK boundary on Windows and macOS. macOS availability is for transport API validation; it does not add macOS capture support or establish the Windows publisher gate. The default feature set retains the unavailable transport boundary without loading the native SDK.

The adapter validates the operator envelope and advisory JWT claims, then requires the SFU's signed-token authentication and acknowledged room, identity, and narrowly scoped publication permission before publishing. It owns no media queue. First frames and feedback-triggered recovery require an IDR, timestamps increase monotonically, and expiry/events terminate publication through bounded room close. Native credentials and media material have no serialization or debug implementation.

The pinned SDK exposes initial join retry controls but no public option to disable every recovery path. The adapter closes on reconnect events and blocks further source submission; its application gate does not constitute proof about every upstream reconnect race. Test the real transport under connection loss before advancing M1. The library does not install a global logger or suppress application auditing. Host logging must filter sensitive SDK targets and raw error/URL content; proof compositions report typed sanitized errors and currently install no Rust log subscriber.
