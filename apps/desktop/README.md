# Desktop client

React/Vite UI and Rust/Tauri shell for the planned Windows publisher. M0 exposes only get_app_info IPC; capture, encoding, audio, RTC sessions, and E2EE remain unavailable. Transmission stays disabled.

## Native Windows development

Use Windows 11 x64 with MSVC C++ Build Tools, Windows SDK, WebView2, pinned Rust, and Bun. Follow [Windows setup](../../docs/development.md#windows-11-x64) and the root bootstrap sequence, then from repository root:

```sh
bun run dev:desktop
```

Tauri starts its own Vite at 127.0.0.1:1420; do not start another desktop Vite on that port. For a development NSIS bundle:

```sh
bun run build:desktop
```

The installer is unsigned. Building a shell is not proof of capture, hardware encoding, or media support.

## Browser-only preview

On macOS/Linux or while working only on the UI:

```sh
bun run --filter @screen-share/desktop dev
```

The browser preview explicitly reports missing IPC and starts no engine. This cannot validate Windows permissions or the native WebView runtime. All three UI languages are available from the header selector.

## Structure and validation

src/app composes the stream-control feature; src-tauri contains commands/composition/capabilities. Pure Rust domain/application and media boundaries live in the root Cargo workspace. Keep SDK/Win32 work out of pure crates and preserve explicit unavailable/unsupported errors.

Use bun run check:ts, bun run check:rust, coverage, and browser E2E for relevant changes. Native shell/IPC/bundle changes also need Windows checks. See [frontend conventions](../../docs/frontend.md), [tests](../../docs/testing.md), and [contributing](../../CONTRIBUTING.md).
