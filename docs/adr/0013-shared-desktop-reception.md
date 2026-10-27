# Shared encrypted reception in the Windows application

Status: accepted · 2026-10-27.

## Context

The user requested watching directly inside the Windows 11 application. The existing
browser receiver already owns encrypted video/audio, designated-publisher checks,
lease-bound cleanup and measured receiver diagnostics. Copying it into the desktop
would create independent security and lifecycle implementations.

## Decision

Move the concrete browser receiver into `@screen-share/rtc-browser`. Both applications
load its public adapter lazily and supply DOM sinks to the shared room workspace.
The package owns LiveKit and has no React, Tauri, authentication or server dependency.
Native capture remains in the owned Rust publisher; playback uses WebView2 WebRTC.

Desktop account and grant requests retain the native private cookie transport.
Content keys remain ephemeral renderer memory and never enter the control service.
The build fixes one public `SCREEN_SHARE_RTC_URL`: origin-only WSS, with WS permitted
only for loopback development. Extend Tauri's existing CSP with that exact WebSocket
origin and its HTTP counterpart for SDK validation, preserving script nonces/hashes
and updater configuration. Permit self/blob workers and media for encrypted playback.
Use the secure HTTPS WebView scheme so E2EE capability checks remain meaningful.

## Consequences and verification

Desktop viewers receive the same room authorization, encryption rejection, renewal,
metrics and cleanup behavior as web viewers. Browser preview can watch without
native publication. Builds must target the deployed API and RTC origins; default
loopback installers do not connect to a remote deployment. Changing the WebView
origin can reset prior renderer locale preferences, while native cookies are separate.

Shared DOM regressions and actual browser transport tests cover the common adapter.
Windows WebView2 playback is separate evidence from Chromium preview, native capture,
physical two-PC/TURN connectivity and prolonged acceptance. Refer to dated validation
for checks actually executed; a configured workflow alone proves no runtime behavior.
