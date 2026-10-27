# Native M1 publisher proof

An explicitly launched Windows 11 diagnostic application composing the selected WGC source, D3D11 conversion, hardware H.264 encoder and encrypted pre-encoded LiveKit publisher. This is the M1 experiment, not the desktop product or M2 authentication. Windows CI builds the utility and executes its non-interactive guards and filesystem tests. Interactive capture/hardware/two-PC acceptance remains unverified until executed with actual equipment.

## Requirements

Use the pinned Bun/Rust versions, Windows 11 x64, MSVC C++ tools/Windows SDK, a current GPU driver, and an explicitly authorized reachable LiveKit instance. Signaling must use WSS; WS is permitted only on loopback. Do not expose the M0 Compose stack or database to a LAN to make the experiment work.

Obtain a current publisher JSON grant using the trusted [operator workflow](../../docs/media-proof.md). Every run needs a fresh experiment room and independently generated media key. Arrange an authenticated encrypted channel to distribute the key separately to the allowed viewers. This program has no public token endpoint and never receives the SFU signing secret.

## Run explicitly

From the repository on Windows, choose a new absolute key output path on a local NTFS volume. Its parent must exist. Example PowerShell:

```powershell
New-Item -ItemType Directory -Force .media-proof | Out-Null
$keyPath = Join-Path (Get-Location).Path '.media-proof\publisher-key'
bun run media:publish -- --publisher-grant .media-proof\run-1\PUBLISHER-ID.json --private-key-output $keyPath --height 1080 --fps 60 --bitrate-bps 10000000 --seconds 120
```

The `windows-desktop` CI job also saves `ss-media-proof.exe` as the seven-day `native-windows-media-proof-development-unsigned` artifact after the native checks pass. It is an unsigned development executable for this explicit experiment, not a release installer. Invoke it with the same arguments above when testing without a local Rust build.

The wrapper limits Cargo to two jobs, uses the SDK-required static Windows CRT flag for this proof, and starts the client with a small OS environment rather than backend credentials. The default executable is a development build, not performance-benchmark evidence.

The Windows system picker chooses exactly one source; canceling starts no capture. A dedicated MTA worker validates scoped SFU identity/permissions and encrypted publication before the STA owner starts WGC. The selected item remains unchanged. Close the proof window to stop. Duration is bounded to 1–240 seconds and current grant expiry; driver hangs terminate only this explicitly launched proof process through its watchdog.

A fresh 32-byte CNG secret is generated in this client. The 43-character UTF-8 key is exported in a newly created file with a protected current-user-only DACL. It rejects overwrite, device/remote/alternate-stream paths, and filesystems without persistent ACL support. Nothing prints the key or sends it to the API. The file is delete-on-close, including process termination; it remains pending deletion while an authorized reader holds a compatible handle. Read/copy it through a trusted user-only reader that supports Windows shared-delete access, then distribute only through your established E2EE channel. Do not put it in a URL, issue, log, or shell argument. The viewer accepts that same string without base64-decoding it.

Viewers expand the optional encrypted receiver and submit their individual viewer grant plus independently delivered key. Publication/subscription counters do not prove decoded playback or independently verified E2EE. Verify visible motion, wrong-key rejection, source recovery, and actual hardware/feedback behavior on two PCs.

## Boundaries

The worker consumes the same bounded WGC slot; it does not queue pixels through IPC, React, JSON, or HTTP. Hardware input is limited to two samples in flight. Bitrate/FPS feedback respects the operator cap; unsupported/zero feedback, authorization loss, transport recovery, source failure, or cleanup errors stop the proof. There is no software encoder or alternate-source fallback. The current pipeline is SDR, one H.264 spatial layer, without audio. Native SDK recovery rejection does not implement strict server-side revocation; M2 session migration remains pending.

The default Tauri shell still has no capture/publication IPC permission. This separate utility is intentionally opt-in. See [PLAN.md](../../PLAN.md), [ADR 0011](../../docs/adr/0011-media-proof-boundaries.md), and [validation evidence](../../docs/validation.md), and [hardware acceptance runbook](../../docs/m1-hardware-runbook.md).
