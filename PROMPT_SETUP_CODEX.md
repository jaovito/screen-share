# Codex prompt: initial project setup

> Usage: place PLAN.md at repository root, open the directory in Codex, and send the prompt below. The plan covers the whole product; this task implements **M0 bootstrap only**. Provisional technical name: screen-share; preserve an existing project's name.
>
> Historical context: this was the original setup prompt. Its pnpm/Vitest and Node runtime choices were later superseded by ADRs 0007/0008/0010 and the current PLAN.md/AGENTS.md. Documentation language is now English at the user's request. Do not reintroduce superseded tools when using this reference.

---

You are a Staff Software Engineer experienced in Rust, Windows, Tauri, TypeScript, WebRTC, security, and developer experience. Work in repository files and deliver an executable, documented, verifiable initial setup.

## 1. Goal and working approach

Create the foundation for private screen sharing among friends. Read PLAN.md and existing repository instructions before editing. Implement only M0: languages, workspaces, architecture, local services, minimal apps, migrations, checks, CI, documentation.

The future product targets Windows 11 publishing, a private web player, rooms of 2–8 people, initially one active stream, application audio, and eight profiles: 480p/720p/1080p/1440p QHD at 30/60 FPS. It will include metrics, quality recommendations, E2EE. Media/private-access features belong to later milestones.

Inspect current state and preserve existing work. Initialize Git only when needed. Make changes locally; creating remotes, pushing, and deployment are outside this request. Resolve routine choices with judgment and record important decisions. Do not stop at a plan/command list: implement, run feasible checks, fix setup problems.

## 2. Stack and versions

Original setup choices, subject to the historical note above:

- TypeScript monorepo with pnpm workspaces.
- Node.js LTS + strict TypeScript + Hono with official Node adapter.
- React + TypeScript + Vite interfaces.
- Tauri 2 + Rust desktop, root Cargo workspace.
- PostgreSQL + Drizzle with versioned SQL migrations.
- Self-hosted LiveKit media infrastructure.
- Biome formatting/lint and Vitest TypeScript tests.
- Rustfmt, clippy, cargo test.
- Docker Compose and GitHub Actions.

Consult compatible stable versions/official docs at implementation time. Pin real versions: .node-version, exact packageManager, concrete stable rust-toolchain.toml, dependencies, OCI images. Generate/version actual manager and Cargo lockfiles rather than fabricating them. Never permanently use latest tags. Record verified versions/system requirements.

Keep tooling small. No Kubernetes, business microservices, broker, Redis, extra monorepo framework, or new backend runtime is required.

## 3. Structure and dependencies

Create files with real responsibilities, avoiding empty directories/unused abstractions:

| Path                   | Responsibility                                    |
| ---------------------- | ------------------------------------------------- |
| apps/control-api       | Hono control API with domain/application/adapters |
| apps/viewer-web        | Web interface/future private player               |
| apps/desktop           | Desktop React/Vite UI                             |
| apps/desktop/src-tauri | Tauri shell/Rust composition                      |
| crates/domain          | Pure client types/validation/rules                |
| crates/application     | Client use cases/ports/state                      |
| crates/media-windows   | Unavailable Windows capture/encode boundary       |
| crates/rtc-livekit     | Unavailable native transport boundary             |
| packages/contracts     | Shared HTTP DTOs/validation                       |
| infra/compose.yaml     | PostgreSQL, LiveKit, optional API profile         |
| infra/livekit          | Versioned template/generated local config         |
| scripts                | Cross-platform utilities                          |
| docs/adr               | Short architecture decisions                      |
| .github/workflows      | CI                                                |

One root Cargo.toml includes src-tauri and crates, with portable default-members. No nested Cargo workspaces. Configure manager workspaces, unique private package names, and workspace: dependencies. Align TypeScript, exports, and module formats with actual builds.

Use hexagonal architecture/modular API monolith. Dependencies point inward: domain imports no Hono, Tauri, LiveKit, Win32, Drizzle. Composition connects adapters/application. ORM entities never leave persistence adapters.

Separate transport contracts/domain entities. Rust IPC DTOs stay small, serialized at the boundary, with verifiable TS counterparts. Document the contract source of truth; avoid premature binding-generation pipelines.

## 4. Minimal working applications

### API

- Startup configuration validation, sanitized errors, request ID, structured logs, graceful shutdown.
- Bounded PostgreSQL pool, diagnostic-query timeouts, proper connection closure.
- GET /healthz proves process liveness.
- GET /readyz authenticates against database and checks required migrations; failures return 503 without sensitive details.
- GET /v1/video-profiles returns eight static profiles/dimensions/FPS without claiming detected hardware capability.
- Small initial control migration, e.g. rooms with opaque ID, mandatory owner, state, timestamps. Do not pre-model all authentication/product features.
- Explicit versioned migrations; no db push default or HTTP-triggered schema changes.

Login, room access, invites, RTC token issuance are unimplemented in this milestone. Do not issue JWTs for arbitrary rooms or trust client-supplied identity as authorization. Unimplemented ports fail explicitly and never grant access by default.

### Web viewer

- Simple home with restrained visual identity, API connectivity, profile catalog.
- Real loading/unavailable/error states.
- Future player clearly marked unimplemented.
- No automatically started camera, microphone, capture, or room connection.

### Desktop

- Tauri shell opens on Windows with React/Vite.
- Small get_app_info-like IPC returns version, platform, actual implementation status.
- UI makes missing capture/streaming explicit and disables transmission.
- Domain profile types/basic states and a use case demonstrate composition without faking a session.
- Typed NotImplemented/UnsupportedPlatform errors, never reachable todo! panics.
- Pure crates compile without Tauri, GTK, Win32, libwebrtc; Windows dependencies are conditional.

Do not install the complete native LiveKit/libwebrtc SDK merely to fill an adapter. Real capture/encoder integration is the next proof. No fictional FPS, active E2EE, or available hardware encoder claims without implementation/evidence.

## 5. Docker Compose and local environment

Provide coherent alternatives:

1. Default development: PostgreSQL/LiveKit in Compose; API/viewer/desktop on host.
2. App profile: container API/one-shot migration using the same infrastructure; interfaces stay on host. Document API port conflicts.

Requirements:

- Versioned images, named PostgreSQL volume, read-only LiveKit mount. Persistence/PGDATA matches selected PostgreSQL major version.
- API multi-stage Dockerfile, correct monorepo context, reproducible installation, unprivileged runtime.
- Dockerignore excludes secrets, local files, caches, build artifacts.
- Explicit loopback publication: suggested PostgreSQL 5432, API 3000, LiveKit signaling 7880, ICE/TCP 7881, UDP mux 7882, as supported by the actual selected release.
- Services bind required container interfaces; host restriction belongs in published mappings. Do not confuse these addresses.
- Distinct internal postgres/livekit addresses and host localhost clients; browser never receives Docker-only hostnames.
- Generate valid local LiveKit config from a template. Do not assume variable expansion in mounted YAML.
- ICE addresses match the release schema; healthy HTTP does not prove media.
- PostgreSQL healthcheck uses an available binary. API depends on healthy database and successful app-profile migration. Each stack:up applies current migrations despite previous success; never trust a stale completed migration container. Bounded application retries remain necessary beyond depends_on.
- No cross-platform default network_mode: host. Document Docker Desktop/WSL limitations for future two-PC RTC.

TURN, domain, public TLS, LAN/cloud deployment belong to the network milestone. No open relay or premature functionality claims. Desktop/Windows capture run natively outside Compose.

## 6. Configuration, scripts, security

Provide Windows/macOS/Linux-compatible utilities without Bash for main flows. Never silently install SDKs, drivers, global tools.

Bootstrap exclusively creates missing .env/local LiveKit files, generates strong random secrets, preserves existing values, and never prints secrets. It is idempotent. Version .env.example with names/explanations/placeholders; ignore effective secrets/configuration.

Database/LiveKit secrets stay in backend/local config, never VITE variables, frontend bundles, diagnostic IPC, URLs, logs, images. CORS/CSP use development allowlists and Tauri permissions stay minimal.

Original root command contract (current commands use bun run per PLAN.md):

| Original command   | Contract                                                        |
| ------------------ | --------------------------------------------------------------- |
| pnpm bootstrap     | Prepare missing local files without overwrites                  |
| pnpm doctor        | Actionable versions/dependencies/configuration/port diagnostics |
| pnpm infra:up      | Start PostgreSQL/LiveKit                                        |
| pnpm infra:down    | Stop infrastructure, preserve volumes                           |
| pnpm db:migrate    | Apply versioned migrations                                      |
| pnpm dev           | Host API/viewer                                                 |
| pnpm dev:desktop   | Desktop and its Vite only, no duplicate web server              |
| pnpm stack:up      | Infrastructure/migration/app-profile API                        |
| pnpm stack:down    | Stop stack, preserve data                                       |
| pnpm check:ts      | Lint, types, relevant tests, TS builds                          |
| pnpm check:rust    | Portable fmt/clippy/tests                                       |
| pnpm check         | Aggregate documented portable checks                            |
| pnpm smoke         | API/catalog/migrations/LiveKit control connectivity             |
| pnpm build:desktop | Windows Tauri build with installed prerequisites                |

Never use docker compose down -v in normal flows. Any necessary destructive reset is separate/explicit. Prefer config --quiet over printing sensitive resolved Compose values.

Smoke performs a timeout-bounded authenticated read-only server SDK call, without credentials/room content. It requires no public token endpoint and does not prove RTC media.

## 7. Verification and CI

Test implemented behavior: profile catalog/validation, application errors, unavailable database/pending-migration readiness, HTTP contract. Include real PostgreSQL migration checks and disposable-volume restart persistence. Normal smoke never restarts development data. Do not add repetitive getter/empty-folder/placeholder tests.

Separate CI jobs:

- Linux: reproducible manager installation, lint, types, tests, API/viewer builds, PostgreSQL integration.
- Portable Rust: fmt, clippy, pure-crate tests.
- Windows: Tauri shell/Windows-boundary check/build with documented prerequisites.
- Compose/API image validation.

Do not indiscriminately run cargo test --workspace --all-targets on Linux if it requires missing desktop libraries. Never disable checks/conceal errors to get green CI.

Run feasible local checks. Missing Docker/Windows/toolchain/registry access does not block independent work, but requires exact unverified-step reporting. Do not claim Windows compilation, media transmission, E2EE, or signed distribution when unexecuted.

## 8. Documentation and completion

Deliver:

- English README with prerequisites, versions, first-run sequence, commands, URLs, host/container modes, troubleshooting.
- AGENTS.md with architectural/security boundaries, checks, media-evidence rules, preserving existing instructions.
- Root PLAN.md as milestone source of truth, checking off only actually completed M0 items.
- docs/architecture.md with modules/dependencies/compact diagram.
- docs/development.md for Windows setup and partial workflows elsewhere.
- docs/security.md for bootstrap controls, current limits, future authorization/E2EE requirements.
- Short ADRs for monorepo, hexagonal architecture, control/media separation, contracts, local environment.
- Editorconfig, gitignore, gitattributes, TS/Biome/Rust configuration, genuine lockfiles.

Completion means a person can clone, install, bootstrap, start infrastructure, migrate, open API/viewer, and start Windows shell by following README.

Final report: created artifacts/structure, selected versions, first-use commands, actual passing/failing/blocked checks with reasons, and concrete next step: native WGC/D3D11/encoder/WebRTC proof. This delivery is the functioning foundation; remaining work follows PLAN.md.

---

## Executor references

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri Vite](https://v2.tauri.app/start/frontend/vite/)
- [Hono Node.js](https://hono.dev/docs/getting-started/nodejs)
- [Original pnpm workspaces reference](https://pnpm.io/workspaces)
- [Cargo workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html)
- [Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/)
- [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/)
- [LiveKit local execution](https://docs.livekit.io/transport/self-hosting/local/)
- [LiveKit ports/firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/)

References reviewed on 2026-10-26. Recheck versions/APIs during implementation; this prompt does not pin unverified release numbers.
