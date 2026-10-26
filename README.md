# Screen Share

Foundation for a private screen-sharing app among friends. This repository implements **M0 only** from [PLAN.md](PLAN.md): control API, web viewer, Tauri shell, contracts, persistence, and local environment.

**Capture, streaming, audio, login, invitations, RTC playback, and E2EE are not implemented.** Transmission stays disabled. There is no room-access/token-issuance endpoint. The profile catalog does not measure computer capability.

## Prerequisites and versions

| Tool                             | Pinned version                                         |
| -------------------------------- | ------------------------------------------------------ |
| Node.js LTS                      | 24.22.1 (.node-version; checks also accept 24 >=24.11) |
| Bun                              | 1.4.3 (.bun-version, packageManager)                   |
| Rust                             | 1.99.1, rustfmt/clippy (rust-toolchain.toml)           |
| TypeScript / Hono / Node adapter | 7.0.2 / 4.13.14 / 2.1.5                                |
| Tailwind CSS / Vite plugin       | 4.3.3 / 4.3.3                                          |
| React / Vite                     | 19.3.1 / 8.3.5                                         |
| Tauri Rust / JS CLI / build      | 2.12.5 / 2.12.4 / 2.7.4                                |
| Drizzle ORM / Kit / pg           | 0.45.4 / 0.31.11 / 8.23.1                              |
| Biome / Bun Test                 | 2.6.3 / 1.4.3 (native to Bun)                          |
| PostgreSQL / LiveKit             | 17.11-bookworm / v1.13.11                              |
| LiveKit server SDK               | 2.19.2                                                 |

Docker/Compose v2 is required for database/SFU and disposable tests. Desktop needs Windows 11 x64, Visual Studio Build Tools with **Desktop development with C++**, Windows SDK, and WebView2 Runtime. Rust uses MSVC. macOS/Linux support API, web interfaces, and portable crates. Scripts do not install SDKs/global tools; Cargo may download the declared toolchain when invoked.

Versions were checked in official registries on 2026-10-26, with tool-generated lockfiles. See [sources/decisions](docs/adr/0001-monorepo.md) and [validation evidence](docs/validation.md).

## First run: host API

Install/activate Bun 1.4.3, Node 24.22.1, and the prerequisites above. From the clone root:

```sh
bun install --frozen-lockfile
bun run bootstrap
bun run doctor
bun run infra:up
bun run db:migrate
bun run dev
```

Open the [viewer](http://localhost:5173), [liveness](http://127.0.0.1:3000/healthz), [readiness](http://127.0.0.1:3000/readyz), and [catalog](http://127.0.0.1:3000/v1/video-profiles). In another terminal, bun run smoke checks these contracts and performs an authenticated read-only LiveKit administrative call. It prints neither credentials nor room content and does not prove media.

Bootstrap creates .env and infra/livekit/local.yaml **only when absent**, using cryptographically random secrets; reruns preserve both. See .env.example for names. After an intentional LiveKit credential change in .env, remove only infra/livekit/local.yaml and rerun bootstrap. For a PostgreSQL password change on an existing volume, coordinate with the database: image environment variables do not change initialized passwords. Never delete volumes to repair configuration.

To open desktop on Windows in another terminal:

```sh
bun run dev:desktop
```

This starts desktop's own Vite at 127.0.0.1:1420, not another viewer/API. M0 desktop uses only get_app_info IPC. Browser preview has no native engine.

## Container API: app profile

Stop bun run dev before switching modes; both APIs use port 3000:

```sh
bun run stack:up
bun run --filter @screen-share/viewer-web dev
bun run smoke
```

stack:up starts infrastructure, stops the prior API, builds the image, runs a **fresh disposable migrator**, and starts API only after success. Every invocation applies/verifies current history rather than trusting an old completed migration container. Do not replace this flow with docker compose up after schema changes. Migration failure leaves API stopped.

The image uses multi-stage build and unprivileged node runtime. Internal database: postgres:5432; internal LiveKit control: http://livekit:7880. Host clients use 127.0.0.1. Browser receives only the public local API URL via VITE_API_URL/default. Never put credentials in VITE variables.

stack:down removes containers/network and preserves the volume. infra:down stops only PostgreSQL/LiveKit. Normal commands never delete data.

## Commands

| Command                           | Behavior                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `bun run bootstrap`               | Create missing local files without printing secrets                          |
| `bun run doctor`                  | Check tools, configuration, Compose, TCP ports; fail on missing requirements |
| `bun run infra:up` / `infra:down` | Start/stop database/SFU, preserve volume                                     |
| `bun run db:migrate`              | Apply versioned SQL through Drizzle with bounded retries                     |
| `bun run dev`                     | Host API/viewer with coordinated shutdown                                    |
| `bun run dev:desktop`             | Tauri with its own Vite, Windows only                                        |
| `bun run stack:up` / `stack:down` | Container API / stop stack without deleting volume                           |
| `bun run check:ts`                | Biome, types, contract/HTTP/DOM tests, three TS app builds                   |
| `bun run check:rust`              | Format all source; locked clippy/tests for four portable crates              |
| `bun run check`                   | TS, portable Rust, disposable-database coverage; requires Docker             |
| `bun run smoke`                   | API, migration/readiness, catalog, authenticated LiveKit control listing     |
| `bun run test:integration`        | Disposable PostgreSQL: migrations, constraints, readiness, cleanup           |
| `bun run test:persistence`        | Verify data/migrations after restart on a disposable volume                  |
| `bun run build:desktop`           | Windows Tauri/NSIS build; unsigned development artifact                      |

Disposable tests use unique names, never development DATABASE_URL. Cleanup removes only test-owned resources. check does not install/download media SDKs.

## Structure

```text
apps/control-api       Hono, composition, modules, migrations
apps/viewer-web        React/Vite and local public catalog
apps/desktop           React/Vite and src-tauri shell
crates/domain          Framework-free rules/profiles
crates/application     Client ports/use case
crates/media-windows   Unavailable capture boundary
crates/rtc-livekit      Unavailable RTC boundary
packages/contracts     HTTP/IPC schemas and compatibility fixture
packages/ui            Shared theme/styles (Tailwind CSS)
infra                  Compose and LiveKit template
scripts                Cross-platform TypeScript/Bun utilities
docs                   Architecture, development, security, evidence, ADRs
```

## Ports and network limits

All Compose publications bind 127.0.0.1: PostgreSQL 5432/TCP, API 3000/TCP, LiveKit 7880/TCP signaling/control, 7881/TCP ICE, 7882/UDP mux. Container processes bind necessary internal interfaces. LiveKit advertises ICE 127.0.0.1 without external STUN discovery. The template uses fields supported by the pinned release, not assumed mounted-file variable interpolation.

This supports control and future same-machine experiments. Docker Desktop/WSL use NAT/VM, and loopback cannot reach another PC. M1 must prove ICE candidates, firewall, and two-PC connectivity. There is no TURN, open relay, public TLS, or LAN setup. Healthy HTTP does not prove WebRTC.

## Troubleshooting

- Wrong Node in doctor: activate .node-version; 24.11 execution is partial until repeated on 24.22.1.
- readyz 503: check infra:up, configured database, and db:migrate. API omits database details from responses/logs. HTTP never triggers migrations.
- Port 3000 busy: stop the previous API mode; use stack:down before returning to host mode.
- Port 5173 busy: set VIEWER_PORT=5174 and matching local CORS_ORIGINS in .env; restart API/viewer. Vite loads root configuration.
- Port 5432 busy: stop the conflicting service or explicitly change both mapping and DATABASE_URL. Do not confuse host address with postgres on Docker's network.
- Docker failure: start Docker Desktop/OrbStack and check docker info. Tests do not mask Docker failures as success.
- LiveKit rejects credentials: check .env matches generated configuration; regenerate the local file only after deciding credential rotation.
- Desktop build fails: follow [Windows setup](docs/development.md); do not test the entire native workspace on Linux without desktop dependencies.

Next, validate pending Windows/CI gates and proceed to **M1: WGC → D3D11 → H.264 encoder → LiveKit/WebRTC** with real two-PC evidence. Remaining product work follows [PLAN.md](PLAN.md).

## Organization and tests

Frontend follows Truco-inspired feature conventions: src/app mounts/composes, features expose small public APIs with nearby tests, shared exists only with concrete reuse. See [frontend conventions](docs/frontend.md) and [test policy](docs/testing.md).

Authored scripts are .ts, executed by Bun and checked by TypeScript. Bun manages workspaces/installation through bun.lock and runs native tests, Vite, and Playwright. Published API stays Node LTS. bun run test coordinates isolated backend/DOM suites importing bun:test. Biome uses 2 spaces, width 100, single quotes, trailing commas. bun run lint includes import boundaries.

```sh
bun run test                  # Unit + DOM components; no Docker
bun run test:integration      # Disposable PostgreSQL
bun run test:coverage         # Per-file 80% lines/functions + inventory
bun run test:e2e:install      # Playwright-managed Chromium
bun run test:e2e              # Real API/database, isolated previews, desktop/mobile
```

check:ts needs no Docker. check adds Rust/complete coverage and requires Docker. Reports live in coverage/index.html, playwright-report, and test-results, locally ignored by Git. Linux CI runs coverage/E2E and uploads reports.

## Bun and local performance

Bun 1.4.3 was adopted after comparing the same suite: median 1.977s on Node 24.22.1 versus 0.916s on Bun across three alternating runs. This is local evidence, not a universal speed guarantee. Coverage/E2E/typechecks were preserved. See [ADR 0007](docs/adr/0007-bun-development.md). Final image stays Node; Bun handles development/build stages.

## Native test runner

Bun Test replaced Vitest after further evaluation. The 32 existing scenarios were preserved and three LCOV policy tests added: 35 unit/DOM tests, 36 with SQL. Local medians were effectively tied: 0.696s Vitest/Bun versus 0.727s native workflow including contracts build/three extra tests. No additional speedup is claimed; the decision simplifies testing. See [ADR 0008](docs/adr/0008-native-bun-test.md).

Native coverage preserves per-file thresholds/inventory. Reports: coverage/server/lcov.info, coverage/frontend/lcov.info, coverage/lcov.info, coverage/coverage-summary.json, and coverage/index.html (per-file summary/uncovered lines). Native counters are not directly comparable to previous V8/Vitest percentages.

## Agent-assisted development

[AGENTS.md](AGENTS.md) contains persistent conventions. [docs/agents.md](docs/agents.md) describes six discoverable roles, five skills, and the private adversarial reviewer dispatched only by the security skill, including examples, ownership, and validation limits. Configuration stays repository-local and inherits session model/permissions. Documentation, code, comments, and developer-facing test descriptions use English; UI supports pt-BR, Spanish, and English; conversations retain the user's language.


## UI languages

Viewer and desktop provide a header language selector for **Português (Brasil)**, **Español**, and **English**. pt-BR is the default/fallback. The selection persists locally per origin; translations work from the bundled app without an external service. UI states, accessibility labels, document language/title, and errors change immediately. Documentation and code comments remain English. See [frontend internationalization](docs/frontend.md#ui-internationalization) for catalogs and extension rules.
