# Development

## Windows 11 x64

1. Install Git, Node 24.22.1, and Bun 1.4.3. Corepack is unnecessary.
2. Install Rust through rustup and Visual Studio Build Tools (Desktop development with C++, MSVC, Windows SDK). Use x86_64-pc-windows-msvc, not MinGW for the shell.
3. Confirm Microsoft Edge WebView2 Runtime. See [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
4. Start Docker Desktop with WSL2 backend for Linux Compose. Windows desktop runs natively, outside WSL/container.
5. Follow README setup in PowerShell/native terminal; main commands do not require Bash.
6. Run bun run dev:desktop. Tauri owns beforeDevCommand, port 1420, and frontendDist relative to src-tauri; do not start Vite manually.
7. Run bun run build:desktop for NSIS. Development executable/installer is unsigned; signing/updates belong to M5.

The Windows job checks crates/adapters, builds/tests the shell IPC DTO, and builds a development bundle. Configured CI is not execution evidence until the workflow runs.

## macOS and Linux

bun run dev, check:ts, check:rust, SQL integration, and Compose are the supported partial workflow. `bun run --filter @screen-share/desktop dev` opens only a UI preview that shows missing IPC and starts no engine. dev:desktop/build:desktop fail explicitly outside Windows at this milestone. Manual compilation elsewhere does not establish capture support.

## Migrations

After changing src/modules/rooms/adapters/schema.ts:

```sh
bun run --filter @screen-share/control-api db:generate
bun run db:migrate
bun run test:integration
bun run test:persistence
```

Review SQL, journal, and snapshot before committing; never edit an applied migration. There is no db push, implicit reset, or HTTP-triggered migration. Integration owns an empty database; persistence uses its own volume and restarts only its own container.

## Development and validation

check:ts builds contracts before consumers, typechecks API tests, and builds apps separately. dev builds contracts once; restart it or rebuild that package after contract edits. Bun scripts propagate failures. Local configuration comes from .env; existing environment variables take precedence. Vite receives only VITE-prefixed variables.

check:rust uses portable default-members without GTK, Tauri, Win32, or libwebrtc. Cargo.lock includes the shell, but domain compilation does not compile it. Manual root checks: `cargo clippy --locked --all-targets -- -D warnings` and `cargo test --locked`. Do not indiscriminately add --workspace on Linux.

Validate Compose without printing secrets using `docker compose --env-file .env -f infra/compose.yaml --profile app config --quiet`. Never publish expanded configuration. Smoke does not restart databases or issue room grants.

## RTC limits

SFU listens on 0.0.0.0 inside its container; host publication is loopback only. rtc.node_ip is the advertised candidate, not a bind address. Configuration uses use_external_ip: false, UDP mux 7882, ICE/TCP 7881, and no concurrent UDP range. This prevents assuming remote access and must be explicitly revisited for M1. Docker Desktop/WSL/NAT may block a route that looks correct in signaling. Authenticated TURN, domain, TLS, LAN, and firewall require later network evidence.

## Shared styling

Viewer/desktop use Tailwind CSS 4.3.3 and official @tailwindcss/vite in both Vites. CSS-first configuration imports tailwindcss and @screen-share/ui/styles.css from each src/app/styles/index.css, with explicit @source for future shared components. No PostCSS/tailwind.config.js is needed here.

packages/ui/src/theme.css defines semantic variables and exposes them through @theme inline: bg-background, text-foreground, bg-card, border-border, bg-primary, text-primary-foreground, etc. Edit tokens there to update both interfaces. packages/ui/src/styles.css preserves layout in the components layer so utilities can override consumers. Biome enables css.parser.tailwindDirectives.

Existing viewer example: className="panel mt-6". Prefer complete utility strings in JSX rather than partial interpolation so detection works. UI exports CSS directly without its own build.

shadcn/ui is not installed; shared components can be added when needed. See [official Vite integration](https://tailwindcss.com/docs/installation/using-vite).

Authored operational scripts are scripts/*.ts with .ts imports, running natively on Bun 1.4.3. Execution does not typecheck; bun run typecheck includes scripts, tooling, configs, and E2E. bun run check includes disposable PostgreSQL coverage and requires Docker; E2E stays separate. See [frontend.md](frontend.md) and [testing.md](testing.md).

Native Bun Test is the unit/DOM runner, with preloads/isolation in scripts/test-suites.ts. Use bun run test for both suites; integration/coverage retain disposable databases. Native reports are LCOV/HTML/JSON without Vitest. See ADR 0008. Documentation, code, comments, and developer-facing test descriptions use English; this does not change product UI language.
