# M1 Windows and two-PC acceptance runbook

Status: prepared, not executed. Do not fill observations with targets or infer a pass from provider CI, SDK options, or synthetic one-host tests. Follow [PLAN.md](../PLAN.md), [the native utility](../apps/media-proof-native/README.md), and [media-proof.md](media-proof.md).

## Prerequisites and scope

Use a Windows 11 x64 publisher with a real GPU and current driver, and a separate authorized viewer PC/browser. Use only an explicitly authorized reachable LiveKit instance with correct TLS and scoped operator credentials. Do not expose the M0 local Compose stack or database to a LAN as an implicit step. Record the tested topology without publishing IPs, tokens, keys, filenames, window titles, or personal content.

Start with the offline [synthetic source](../tests/media-proof/source/index.html), opened in its own browser window. Its CSS motion is a reference input, not a measured cadence. After that passes, repeat with the game exhibiting the actual background/focus problem. Select only the intended window; use monitor capture only in a separately explicit test. Keep audio off during this initial standalone M1 video proof. Test the implemented desktop system/application audio separately, with explicit consent and the selected process creation-time binding.

Record only relevant technical metadata: OS build, GPU model/driver, exact commit/toolchain/SDK versions, viewer/browser version, selected catalog profile/bitrate cap, authorized participant count, duration and network conditions. Avoid system names, account names, serial numbers and credentials.

## Ordered checks

1. Run normal supported checks, then the explicit `capture_probe` and `encoder_probe` commands from media-proof.md. Cancel the picker once and confirm capture does not start. For an actual run require nonzero acquired/encoded output; counts alone do not prove visible correctness or hardware acceleration. The hardware-only adapter must reject unsupported devices rather than silently use software.
2. Create a fresh reviewed operator plan and room-scoped grants. Verify at most eight distinct authorized IDs and one publisher. Deliver individual grants only to their intended participants. Never reuse a previous run's room/key to simulate revocation.
3. Launch `bun run media:publish` with the publisher grant and a new absolute private key output path. Confirm overwrite is refused, no key appears in output, no capture starts if authorization/encryption preparation fails, and source selection remains explicit.
4. Read the transient key through a trusted local reader and distribute it separately through an established authenticated E2EE channel. Configure the web receiver with its viewer grant and that exact UTF-8 string. Require real visible motion and correct dimensions on the separate PC; a subscribed-track label alone is insufficient.
5. Repeat with a different key and with an unencrypted/wrong-publisher track using an assessment-owned synthetic client. Expect no decoded media/automatic plaintext fallback. Do not change a real participant's permissions or attack a shared service to create a negative case.
6. Exercise focus loss, Alt+Tab, minimize/restore, source resize and mode changes separately. The same capture item must remain selected. Distinguish an application that stops rendering from a failed capture/encoder. Repeat 100 Alt+Tab cycles for the affected game; record measured recovery distributions only with a defined observation method and sufficient samples.
7. Close the selected source, revoke/expire the proof grant, close the proof window and simulate an owned network interruption. Publication/capture must stop, failures stay explicit, and recovery must not select another source or silently reconnect. Current proof recovery intentionally requires a new explicit experiment; it does not implement M2 room migration/strict server revocation.
8. Verify bitrate/keyframe feedback with controlled test-only network pressure and a new authorized viewer joining midstream. Require actual encoder updates and decodable keyframes, rather than interpreting the existence of a feedback method as successful application. Zero/unsupported feedback currently stops the conservative proof; this is not M3 automatic recovery/adaptation.
9. Repeat each of the eight profiles on hardware that advertises the required capabilities. Initial catalog availability is not measured support. Test NVIDIA, AMD, integrated/hybrid machines, multiple monitors and HDR separately before making compatibility claims. The current converter is SDR and does not implement HDR tone mapping.

## Measurements and evidence

Keep target, capture-consumed, encoder-submitted, encoded and viewer-decoded cadence distinct. Utility output reports actual counts and SDK-accepted encoded payload bytes; it does not report wire bitrate or decoder FPS. Obtain receiver counters through browser-local WebRTC diagnostics with counter deltas on the same stream. Reset baselines after a new session. Missing fields stay unavailable. Do not upload a raw diagnostic dump containing network/signaling information.

Measure all relevant processes, CPU, working-set/private memory, GPU/video-encode engine, VRAM and game FPS/frame-time impact against a documented baseline. The standalone development proof is not the final Tauri/WebView process budget. Do not infer encoder saturation from total CPU, or latency from RTT. End-to-end visual latency and p95 require a defined calibrated observation method and real samples; mark them unmeasured if that method is unavailable.

Five-minute grants and the utility's maximum 240-second capture interval bound this first experiment. Do not disable expiry or ignore authorization to claim a two-hour continuous stability test. Secure renewal/prolonged-product testing remains separate pending work. Repeated short runs are not equivalent to one prolonged run.

Store a voluntary sanitized English report with hardware/profile/topology, exact commands, duration, observations, failures, cleanup and unresolved cases. Include measured values only. Retain no personal recording, screenshot, key, token, invite or source title. Synthetic reference evidence and numeric summaries must remain distinct from personal game content.

## Advance or revise

M1 passes only after the Windows/GPU and two-PC evidence supports the chosen capture/conversion/encoder/transport/key path and feedback/recovery assumptions. If a stage is unsupported, stalls, changes the source, decodes with a wrong key, or cannot provide the required evidence, revise that stage and rerun its gate. Keep M1 open; do not advance M2–M5 or advertise production readiness merely because CI is green.

## Product resource recovery and diagnostics acceptance

Use the normal authenticated Windows desktop for this additional gate. In a controlled test session, exercise a supported display-mode/device-reset case for the selected item and confirm that resource recovery retains the same item/session, never opens a picker, publishes no stale-generation output and resumes with new parameter-set IDR data. Record successful recovery count and the three session-total attempt bound; repeat with user pause, session revocation and source closure to confirm those gates prevent recovery. Cleanup failure must stop publication rather than claiming successful recovery. Do not substitute the pure retry-policy or generation tests for this device exercise.

Inspect the once-per-second diagnostics and five-second evidence window. Record conversion submission CPU wall time, input-to-output latency, actual captured/encoded cadence and fresh transport targets. These are different quantities: input-to-output latency includes asynchronous MFT/driver/GPU queues, conversion submission is not GPU execution time, transport target is not measured upload throughput and RTT is not visual latency. Sparse updates from a static or minimized source must remain inconclusive without independently observed rendering activity. Validate source-closed, authorization and encoder/capture error explanations in all supported UI locales.
