# Validation evidence — M0

Date: 2026-10-26. Host: macOS arm64; Docker Engine 29.8.2 through OrbStack, Compose v2. This records local execution; no remote workflow ran and no code was published. Sections retain historical tools/results rather than substituting current commands into past evidence.

## Results

| Executed check                                             | Result                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm install --frozen-lockfile                             | Passed, five workspace packages; genuine pnpm 10.20.0 lockfile                                                                                            |
| cargo generate-lockfile                                    | Passed, genuine Cargo.lock including shell                                                                                                                |
| Repeated pnpm bootstrap                                    | Passed; byte-for-byte comparison confirmed both local files preserved                                                                                     |
| pnpm run doctor on Node 24.22.1                            | Passed; Node/pnpm/Rust, configuration, Compose available; occupied ports informational                                                                    |
| pnpm check on Node 24.22.1 / Rust 1.99.1                   | Passed: Biome, types, seven TS/HTTP/contract tests, API/viewer/desktop UI builds, fmt/clippy, three portable Rust tests                                   |
| pnpm test:integration                                      | Passed on disposable PostgreSQL 17.11: readiness 503 before migration, real migration/reexecution, constraints, fresh connection, 503 for pending history |
| pnpm test:persistence                                      | Passed: migration and real room record survived PostgreSQL restart on disposable volume                                                                   |
| pnpm infra:up + pnpm db:migrate                            | Passed: database/SFU started, local migration applied                                                                                                     |
| Compose config --quiet                                     | Passed without resolved configuration output                                                                                                              |
| Repeated pnpm stack:up                                     | Passed: multi-stage image, unprivileged runtime, fresh migrator each run, API ready only after success                                                    |
| Host pnpm smoke / compiled in-image smoke                  | Passed: HTTP/catalog/migrations/readiness/authenticated LiveKit listRooms with timeout, no room content/credentials output                                |
| Host pnpm dev                                              | Passed on free temporary API/viewer ports; real readiness 200/HTML; temporary processes stopped                                                           |
| cargo check --locked -p screen-share-desktop --all-targets | Passed on macOS, including Tauri configuration/permissions                                                                                                |
| cargo test --locked -p screen-share-desktop --lib          | Passed on macOS: serialized IPC fixture compatible with TS                                                                                                |
| Browser viewer                                             | Passed: eight profiles, retry, aborted-request unavailable state, invalid-response error, real-API recovery                                               |
| Viewer at 1280px/390px                                     | No horizontal overflow; inspected screenshots in docs/evidence                                                                                            |
| Desktop browser preview                                    | Passed: missing IPC explicit, transmission disabled                                                                                                       |
| Git/Docker context                                         | Effective .env/LiveKit, dependencies, target, temporary artifacts ignored; no remote/push/deploy                                                          |

Host originally had Node 24.11.0. Initial checks ran there; final aggregate checks repeated on temporarily downloaded Node 24.22.1 under /tmp, verified against official SHASUMS256, without changing global installation. Image uses Node 24.22.1.

## Issues found and corrected

- Hono's return type includes HTTP/2; shutdown narrows before HTTP/1-specific methods.
- Invalid URL refinements must return false rather than leak URL exceptions outside sanitized validation.
- Tauri macOS checks require PNG alongside ICO; both original assets were added.
- Profile validation rejects inconsistent dimensions and duplicates.
- Generated browser/Tauri artifacts stay outside source lint and Git; source checks remain active.
- pnpm 10.20.0 reserves pnpm doctor; project diagnostics use pnpm run doctor without global wrappers.
- Ports 5173/5174/3001 belonged to other projects; none were stopped. Local .env uses VIEWER_PORT=5175/matching CORS; host-mode tests allocated free temporary ports.

## Limits and pending gates

- **Windows 11 x64 unavailable:** shell build/check/execution, runtime permissions, Windows IPC tests, NSIS bundle remain unexecuted on Windows. Its workflow is configured but did not run here.
- **GitHub Actions not executed:** Linux/Rust/Windows/Compose jobs are versioned; provider results remain pending.
- **Media outside M0:** no WGC, D3D11, encoder, WebRTC media, audio, two-PC ICE proof, product authentication, or E2EE. LiveKit listRooms proves control connectivity/authentication only.
- No signed installer, domain, public TLS, TURN, LAN/cloud deployment delivered.

## Observed OCI images

- postgres:17.11-bookworm: sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27.
- livekit/livekit-server:v1.13.11: sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20.
- node:24.22.1-bookworm-slim: sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205.

Concrete tags were used; digests record these pulls. Never retain credentials with evidence.

## Next step

Validate M0 Windows gate, then start M1: WGC → D3D11 → hardware H.264 → LiveKit/WebRTC, with two PCs, real metrics, same-source Alt+Tab recovery, and explicit E2EE proof per PLAN.md.

## Update: shared Tailwind

Tailwind CSS/@tailwindcss/vite 4.3.3 configured in viewer/desktop, tokens/styles centralized in packages/ui, lockfile updated. pnpm check:ts passed types/seven tests/builds. After CSS selector organization, pnpm exec biome check . passed without warnings; both frontend builds repeated successfully.

Vite previews restarted for the plugin. Browser inspection confirmed min-h-screen, bg-background, text-foreground, mt-6 generated expected properties, with no horizontal overflow at 1280px/390px. Dark theme preserved, desktop transmission disabled. No Rust/media behavior changed.

## Update: Truco conventions and development tooling

Organization/readability adapted from ~/www/truco into AGENTS.md, frontend/testing docs, ADR 0006. Frontends moved to app/features, public feature APIs, nearby hooks/services, exclusive feature styles. Actual shared tokens/styles stay in packages/ui. Biome uses width 100, single quotes, 2 spaces, trailing commas, preserving logical-block separation.

All authored MJS scripts became TypeScript running on Node 24; no authored JS/MJS/CJS remained. Strict types cover scripts/tooling/configs/DOM/API/E2E. pnpm/Vitest were retained at this stage; Bun was unnecessary for that requirement.

Local results:

- Full typecheck, including Node 24.22.1, Biome, architecture checks passed.
- Complete coverage: **33 passing tests**, **98.70% lines**, **96% functions** aggregate; every measured file met **80% per file**. Inventory confirmed **23 executable product files**; architecture analyzer also measured.
- Tooling regressions reject private imports/cycles, missing sources, and actual Biome global/hook violations. Biome fixture uses an exclusive temporary file without overwrites and guaranteed cleanup.
- **6 E2E passed** in desktop/mobile Chromium, real disposable API/PostgreSQL, migrations, isolated production previews. Failure cases use explicit interception; main case real HTTP/database. Viewer/desktop-preview screenshots inspected without distortion/overflow.
- TypeScript bootstrap/doctor passed preserving local config. check:rust passed fmt/clippy/three portable tests.
- TypeScript persistence passed; room data/migration history survived disposable container restart. Frozen installation passed.
- Multi-stage API image built after service reorganization/test dependency updates.
- Linux CI now requires coverage/E2E and uploads reports/traces; remote execution remains unverified, Windows shell pending.

Local reports: coverage/index.html, coverage/lcov.info, coverage/coverage-summary.json, playwright-report/index.html, success screenshots under test-results. Reports are unversioned; tooling/coverage/inventory.ts remains in Git/lint.

Justified exclusions are documented in testing.md: minimal CLI wrappers/execution infrastructure are outside product denominator; executable server/migration/smoke behavior was extracted to measured runtime. TS coverage is neither Rust coverage nor media/E2EE proof.

## Update: Bun development adoption

Bun **1.4.3** adopted for workspaces/tool runtime after user-requested evaluation. ADR 0007/docs/benchmarks/bun-2026-10-26.json record data.

Local macOS arm64 benchmark, same 32 Vitest 5.0.5 tests, three alternating runs including startup, caches retained:

- Node 24.22.1: 3.344s / 1.800s / 1.977s; median **1.977s**.
- Bun 1.4.3: 1.718s / 0.802s / 0.916s; median **0.916s**.
- Approximately **54% less time**, **2.16x** in this sample. Bun workers verified by process.execPath/process.versions.bun, not inferred from parent alone. No universal guarantee.

Post-adoption validation:

- bun install --frozen-lockfile/check:ts also passed in a clean copy without node_modules, .env, pnpm caches/links, prior artifacts. Bun generated lockfile by migrating actual prior lock; pnpm workspace/lock files removed.
- Coverage passed **33 tests**, **98.70% lines**, **96% functions**, per-file 80%/23-source inventory preserved. Temporary 100% threshold failed nonzero without changing permanent policy/reports.
- E2E passed **6 scenarios**, desktop/mobile Chromium, Vite previews/Playwright on Bun, compiled API on **Node 24.22.1**, disposable PostgreSQL.
- dev passed with isolated temporary API/viewer ports. Bootstrap/doctor passed; diagnostics distinguish Bun from Node-compatibility version and query real Node separately.
- Rust fmt/clippy/three tests passed. Disposable-database restart persistence passed through Bun runner.
- Multi-stage Docker with oven/bun:1.4.3 install/build passed. Final node:24.22.1-bookworm-slim remains Bun-free, unprivileged, with filtered production dependencies.
- stack:up/authenticated LiveKit smoke passed, fresh migrations/API Node ready. Tauri CLI 2.12.4 ran on Bun/macOS; Windows build/execution pending.

At that historical stage Bun remained outside browser/domain and Vitest was retained: bun run test, not bun test. Types/security tools/thresholds remained. CI installs pinned Bun and retains Node for API/E2E; remote execution unconfirmed. No push/deploy/media scope change.

## Update: native Bun Test

Native Bun Test replaced Vitest/provider per ADR 0008. Mocks/timers/React mounting use native APIs; backend/DOM are separate processes with per-file isolation. Playwright remains E2E.

- Frozen installation/check:ts passed in clean copy without dependencies/local config/prior builds: types, Biome, architecture, 35 unit/DOM tests, builds. Main workspace passed too.
- Coverage passed **36 tests** including real disposable PostgreSQL: **99.14% lines**, **96.70% functions**, **80% per file**, **23 executable product sources** in inventory. Native counters are not comparable directly to historical V8. Docker execution completed with required daemon access.
- LCOV regressions reject low individual coverage despite high averages, invalid counters, and sub-80% rounded to 80%. A passing-test fixture with only 50% function coverage confirmed Bun exit 1 under temporary 100% target, without changing permanent policy.
- **6 E2E passed** after Vitest removal, compiled Node 24.22.1 API/disposable PostgreSQL.
- Multi-stage Docker built with new lockfile; Bun installs/builds, Node 24.22.1 runs final API.
- No active Vitest imports/config/dependencies remain. Native workflow produces HTML per-file/uncovered-line summary, JSON, LCOV.

Three alternating runs without coverage/database/E2E: Vitest on Bun (32 tests) median **0.696s**; native Bun (35 tests/contracts build) **0.727s**. Costs differ, results effectively tied, no extra speedup claimed. Raw data: docs/benchmarks/bun-native-2026-10-26.json. This supersedes the historical decision above to retain Vitest. Remote CI, Windows shell, media implementation/proofs remain pending.

## Update: repository instructions, agents, skills

AGENTS.md gained scoped reading, engineering workflow, integration rules, six .codex/agents roles/five .agents/skills workflows. Neon preferences, architecture, privacy, frontend organization, production Node runtime, gates preserved. docs/agents.md covers usage/maintenance; configuration neither implements media nor starts M1.

Checks executed on 2026-10-26:

- Six TOML files parsed with Bun.TOML.parse; required fields/unique names/file-name matching verified. No model/permission/MCP/sandbox overrides.
- Five skills passed skill-creator quick_validate.py. YAML metadata parsed, short descriptions valid, prompts reference their skill names.
- 36 local links verified in root instructions/guide/skills. Consistency review preserved 80% per-file gate and M0/Windows/CI/media evidence distinctions.
- Biome/git diff --check passed. No executable/dependency/runtime changes; product suites were not repeated for that documentation-only update.

Formats/discovery locations were checked against official OpenAI docs linked in agents.md. Syntax/document checks do not confirm client discovery or execution of custom roles. No global configuration changed.


## Update: private adversarial reviewer and English documentation

At the user's request, ss-security-review now dispatches a private independent attacker-minded reviewer for actual security assessments. Its complete prompt is a skill-local reference, not a globally registered custom agent. It supports bounded local executable proofs on synthetic, assessment-owned resources; the coordinator verifies findings and separates confirmed issues, hypotheses, and future gates. Editing/translating the skill does not trigger an assessment. Workflow routing is not a separate sandbox or an unbypassable access-control mechanism.

Repository documentation, root instructions, all skill/agent prompts and metadata, authored comments, developer-facing test descriptions, and example/permission descriptions were translated into English. Historical decisions, commands, metrics, image digests, source URLs, and pending gates were preserved. Three ADR filenames were changed to English with their sequence numbers preserved. Existing UI/runtime strings and protocol values were preserved; this change does not localize the product.

Validation executed on 2026-10-26:

- Five skills passed skill-creator quick_validate.py; YAML metadata parsed with valid short descriptions and skill-name prompts. Six standalone agent TOML files parsed with required fields and unique file/name correspondence. The private reviewer is absent from the discoverable agent directory.
- All 25 maintained Markdown documents passed an English-prose scan and all 58 local references resolved. Original source URLs in PLAN.md, setup prompt, and README were preserved. Authored code comments were inspected after translation.
- bun run check:ts passed: Biome, strict types, architecture, 35 unit/DOM tests, and builds.
- bun run test:coverage passed **36 tests**, including disposable PostgreSQL, with **99.14% lines**, **96.70% functions**, the **80% per-file gate**, and **23 product runtime files** confirmed by inventory.
- bun run check:rust passed fmt, clippy, and **three portable tests**. Windows shell/permissions execution remains unverified on Windows.
- E2E was not repeated: UI behavior, runtime contracts, and build configuration did not change. No adversarial security assessment or exploit proof was run merely to configure this workflow; syntax/consistency checks are not evidence of agent execution or system security.

No dependency, global configuration, remote service, development data, or deployment was changed.


## Update: UI internationalization

i18next 26.5.11/react-i18next 17.1.9 were added with exact versions and a tool-generated Bun lockfile. packages/i18n provides isolated providers, a shared accessible selector, canonical supported locales, and per-origin localStorage preference. Viewer/desktop feature catalogs contain pt-BR/es/en, with English key schemas and typed hooks. pt-BR is default/fallback. Metadata, errors/status, and profile interpolation translate without repeating control requests. See ADR 0009/frontend.md.

Executed on 2026-10-26:

- bun run check:ts passed Biome, strict app/script/test types, architecture boundaries, **40 unit/DOM tests**, and production builds. Final type/architecture checks also include the added E2E cases.
- bun run test:coverage passed **41 tests** including real disposable PostgreSQL; **99.29% lines**, **97.35% functions**, **80% per-file gate** preserved; inventory confirmed **33 product runtime files**, including all catalogs/shared locale code. No coverage exclusions were added.
- bun run test:e2e passed **10 scenarios** in desktop/mobile Chromium, including three viewer languages, desktop English/Spanish, local persistence after reload, document lang/title, eight real profiles, unavailable IPC, disabled media, and overflow checks. Compiled API ran on pinned Node 24.22.1 against disposable PostgreSQL.
- Actual E2E screenshots of English desktop viewer, Spanish mobile viewer, and Spanish desktop preview at desktop/mobile sizes were inspected. Copy remains readable with responsive wrapping and no horizontal overflow. Screenshots/reports remain ignored local artifacts under test-results/playwright-report.
- Docker app-profile API image built successfully with the extra workspace manifest and frozen lockfile; production dependencies remain filtered to control-api/contracts and final runtime remains Node.
- DOM regressions cover invalid saved locale, storage read/write failures, in-flight translated state, native errors, persistence across remount, and unchanged HTTP/IPC counts. No SDK/platform identifiers, API schema, or capture permissions changed.

Preferences are origin-local, with explicit selection and no browser-language detection. Resources are bundled; there is no external translation request/service. Native Windows shell execution and remote CI remain unverified; this UI change does not establish media/E2EE support. Rust behavior was not changed and its checks were not repeated for this UI task.


## Update: Bun API runtime, standalone builds, and import aliases

At the user's request, API source execution now uses Bun/native Bun.serve and optional builds produce one standalone executable with serve/migrate/smoke/ready commands. Embedded drizzle SQL/meta assets preserve readiness/history checks without source, node_modules, or CWD assumptions. Frontends define app/features/shared aliases, API defines modules/runtime aliases, all scoped in their tsconfig. Vite uses native tsconfig path support; authored local imports omit TS/JS extensions. Contracts export TS source and no longer emit JavaScript/declarations. See ADR 0010.

Executed locally on 2026-10-26 (macOS arm64 host, Linux arm64 Docker):

- bun run check:ts passed lint, strict types, alias-aware boundaries/cycles, **46 unit/DOM tests**, frontend builds, and native executable build. Final type/architecture checks also cover the binary/E2E helpers.
- bun run test:coverage passed **47 tests**, including real disposable PostgreSQL and native Bun HTTP; **99.32% lines**, **97.48% functions**, the **80% per-file gate**, and **35 product runtime files** in inventory. No runtime behavior was hidden from coverage; removed migrate/smoke wrappers were replaced by a measured command dispatcher, with only the minimal src/index.ts entry excluded.
- Alias regressions reject private cross-feature imports, shared/app/feature direction violations, domain/application imports of adapters or runtime, and alias cycles. Native HTTP regressions cover actual loopback requests, graceful drain, idempotent shutdown, forced deadlines, late completion, bind errors, pool-close errors, and sanitized failure logs. Socket tests require explicit loopback permission in this sandbox; they passed with that access.
- bun run test:binary passed: host executable copied alone into an empty temporary directory, real disposable migrations applied twice, readiness/catalog/eight-profile contract/no token endpoint verified, SIGTERM exit 0 confirmed. Temporary processes/files/database were cleaned up. This is macOS arm64 evidence, not Windows/cross-target evidence.
- bun run test:e2e passed **10 desktop/mobile scenarios** with API started directly by Bun from source. It was repeated after removing API dist and confirming contracts dist absent; the runner built only browser interfaces, proving source API execution has no build prerequisite. The optional host executable was regenerated afterward.
- Linux image built and bun run stack:up passed while preserving development volumes. A fresh embedded migrator ran before startup; executable ready healthcheck and authenticated compiled LiveKit smoke passed. Container inspection confirmed UID 10001, no Node executable, and no /app/node_modules.
- Runtime base pinned to debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8. Build/runtime architecture is Linux arm64 here. CA certificates/libstdc++ are present.
- bun run doctor and frozen installation passed without requiring Node. Source/binary scan confirmed no emitted API/contracts JS and no local credential values in the host binary. Local docs/links and extensionless authored imports were checked.

CI configuration now installs Bun, runs the standalone check, starts source API E2E, and uses compiled smoke for Compose. Provider CI and native Windows remain unexecuted. Browser output remains Vite JavaScript; the new binary preference applies to the API. There is no claim of new production performance, media, authentication, or E2EE capability. Rust behavior was unchanged and portable Rust checks were not repeated for this runtime/import change. Historical Node decisions/results above remain historical and are superseded by this section/ADR 0010.

## Update: open-source onboarding and GitHub governance

Prepared on 2026-10-26: public-facing root/application READMEs, contribution and private security reporting guides, official MIT license, issue/PR templates, universal CODEOWNERS, versioned branch rulesets, and pinned least-privilege GitHub workflows. The author-specific approval policy compares immutable identities and current review/head metadata. Its write-enabled reconciliation executes only trusted main-branch code; contribution CI and review-event signals have no write permissions.

Executed locally:

- `bun run check:ts` passed lint, strict types (including the GitHub runner), architecture, **51 unit/DOM tests**, browser builds, and standalone API compilation.
- `bun run test:coverage` passed **52 tests** with disposable PostgreSQL; **99.34% lines**, **97.54% functions**, the unchanged **80% per-file gate**, and all **35 product runtime files** measured. The review decision helper has 100% line/function coverage. Regressions cover the owner-author exemption, other authors/reviewers, current versus stale heads, changes requested, dismissed reviews, comments, submission ordering, and invalid identity/head metadata.
- Official actionlint 1.7.12 (download checksum verified) accepted all workflows. JSON rulesets and local Markdown references were checked.
- All 295 historical Git blobs were scanned against the three local credential values before initial publication; no matches. Local .env and generated LiveKit credentials remain untracked.

Remote configuration and first provider CI runs must be inspected after the initial push; these local results do not establish Windows or remote CI success. Existing product runtime/UI behavior was unchanged, so browser E2E and portable Rust suites were not repeated locally for this documentation/governance change. There is no new media or production-readiness claim.

## M1 implementation: local evidence before Windows feature CI

Prepared across 2026-10-26–27. This is the first M1 implementation, not completion of M1 or M2–M5. A separate opt-in Windows utility composes consent/WGC, D3D11 conversion, asynchronous hardware H.264 and scoped encrypted native transport; the regular Tauri shell remains disabled. See media-proof.md, apps/media-proof-native/README.md and ADR 0011.

Local results:

- `bun run check:ts` and `bun run test:coverage` passed **73 unit/DOM tests**, **74 including disposable PostgreSQL**, **99.09% lines / 97.22% functions**, the unchanged **80% per-file gate**, and **38 product runtime files** measured. Final operational scripts are separately typechecked. An initial extra run without socket permission failed the real HTTP bind in this sandbox; it was rerun with loopback access rather than skipped.
- `bun run check:rust` passed the portable fmt/clippy/tests, including source/session/epoch rules, an injected monotonic clock, delayed-operation expiration, bounded frame ownership and H.264 framing. The hardware normalizer adds five portable Annex-B/AVCC/header-refresh regressions. The proof input file reader has a separate host regression.
- The opt-in native SDK compiled and passed strict Clippy on macOS arm64. Native grant/key parsing, exact subsecond expiry, bitrate preflight, and asynchronous shutdown timeout/retry/terminal failures have network-free unit regressions.
- `bun run test:e2e -- --workers=1` passed **12 desktop/mobile scenarios**. Two selected proof-panel cases were repeated to generate/inspect actual desktop/mobile screenshots; copy, form layout and responsive wrapping were inspected without overflow. Screenshots contain no credential or captured personal content.
- `bun run test:media` passed an actual LiveKit/browser worker/decoder test: a synthetic 320×180/5 FPS H.264 publisher, correct-key viewer decoding multiple frames, and wrong-key viewer decoding zero while the correct viewer continues. This is one-host browser evidence.
- `bun run test:media:native` passed actual Rust SDK 0.9.7 → browser SDK 2.23.0 interoperability with bounded synthetic 854×480 Annex-B samples generated by WebCodecs. The publisher used pre-encoded H.264 and the same independently distributed UTF-8 key representation; correct-key decode and wrong-key rejection were both observed. No WGC, hardware encoder or personal media was used.
- The native proof exposed a real macOS Objective-C category link failure; the official SDK-required `-ObjC` flag is now scoped to the test executable. Native WebRTC ignores loopback interfaces, so the owned SFU advertises its private OrbStack container interface while published ports/signaling stay on 127.0.0.1. A preflight fails explicitly when a Docker runtime cannot route that private interface. No token privilege was broadened, LAN listener opened or SDK fork introduced.
- Windows-target strict Clippy accepted WGC/D3D11/Media Foundation adapters and explicit capture/encoder probes, including the producer/consumer thread ownership types. Those commands did not link or execute Windows capture. The complete publisher cross-check was blocked in a dependency because this Mac lacks the Windows MSVC CRT headers (`ring` could not find assert.h); the feature CI must build the full executable and execute ACL/pacing/owned-watchdog tests on actual Windows.
- Local builds used at most two Cargo jobs; browser suites used one worker. The owned SFU was limited to one CPU/256 MiB. Memory-pressure snapshots during native builds showed over 40% free memory. Development databases/services/volumes were preserved and synthetic resources cleaned up.

Independent security review found and drove fixes for cleanup exceptions, stale operation clocks, rounded native expiry and false cleanup success; final input loading/watchdog hardening and private key tests are recorded in security-review-m1.md. No security certification is claimed.

Provider CI for bootstrap commit 0b77a70 passed all four jobs in [run 40432835471](https://github.com/jaovito/screen-share/actions/runs/40432835471), including Windows IPC/unsigned NSIS build. That is earlier bootstrap evidence, not the new proof's Windows result. At this draft snapshot, new Windows feature CI/key ACL execution remains pending. Interactive Windows 11/GPU capture, encoder feedback under pressure, two physical PCs, Alt+Tab/source recovery, audio, prolonged tests and measured budgets remain open PLAN.md gates; M2–M5 have not been advanced.


### First feature-CI correction

The first M1 PR run (40475111381) passed the Linux image, portable Rust, all 74 TS/database tests and 12 desktop/mobile E2E cases, then failed during the media fixture's RTC connection. The same forced-loopback failure was reproduced locally; no codec/privacy assertion was relaxed. Both transport fixtures now advertise only the owned SFU's routable private container interface, retaining loopback-published host ports and a fail-fast private-route prerequisite. Local browser H.264 negotiation/worker/decode/wrong-key regression passed after the change. Windows native validation is placed before slower desktop packaging so API/ACL failures surface earlier. No LAN configuration, grant privilege or required check was weakened.
