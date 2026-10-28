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

The Windows native commands are separate CI steps: each Cargo exit status must gate the job independently rather than relying on the final command of a PowerShell block. The pure publisher arguments and bounded regular-file reader also run as host tests; Windows filesystem/graphics behavior remains platform-specific.


### Executed Windows and Linux feature CI

[Run 40476236349](https://github.com/jaovito/screen-share/actions/runs/40476236349) passed on commit `5052fa0` on 2026-10-27: TypeScript/PostgreSQL, portable Rust, Compose image, Windows desktop and code-owner policy checks. The Windows logs were inspected beyond the grouped step status: all nine native SDK guard tests, eight acquisition/framing/owned-watchdog tests, and six publisher pacing/input/private-key filesystem tests passed. The private-key tests inspect the protected current-user DACL, fresh key generation, overwrite refusal and delete-on-close behavior on Windows. The complete opt-in publisher compiled, the Tauri IPC test passed, and the unsigned NSIS bundle was produced. No interactive capture or GPU encoder ran in this hosted job.

The same run passed the 74 TypeScript/database tests, 12 browser UI scenarios, real encrypted H.264 browser transport fixture, API standalone executable/persistence checks and Compose smoke. Subsequent changes extract and host-test the argument parser, reject duplicate flags, split native CI commands into independent failure gates, and add the physical acceptance runbook/offline synthetic source. Those follow-up changes require their own CI result; the run above proves the identified commit only.

The follow-up CI initially rejected two named synthetic-source `div` elements without an accessible role. This was reproduced with the exact Biome HTML lint command, then fixed by assigning their graphics `img` roles. No accessibility rule was disabled.

## Private product implementation — 2026-10-27

The user authorized implementing M1–M5 product code independently of physical acceptance sequencing (ADR 0012). The normal desktop/viewer now use real authentication, private rooms, invitations, session transitions, short-lived grants and durable cleanup; the native sidecar supports capture, eight profiles, consented audio, pause/resume and bounded adaptation. Documentation distinguishes implemented behavior from unexecuted hardware/release acceptance.

Executed on macOS arm64 with bounded concurrency:

- `bun run check:ts`: strict TypeScript, Biome, architectural dependency/public-export checks, unit/DOM tests, both frontend builds and standalone API compilation passed. The first sandboxed attempt was denied loopback binding; the same check passed with local network access, without changing tests.
- `bun run test:coverage`: **148 tests** (72 server/database and 76 DOM), **82 runtime files**, **99.19% lines / 96.62% functions**, with unchanged **80% lines/functions per file** and complete source inventory. Integration uses real HTTP/application paths and owned disposable PostgreSQL, not the development database. It covers session/approval/removal races, invite expiry/revocation, pending/anonymous/foreign-room access, current schema readiness, short-lived least-privilege grants and private advisory reports.
- `bun run test:e2e`: **8 desktop/mobile scenarios** passed in 39.1 seconds, exercising account creation, owner approval, key preparation, session invalidation/removal, logout, failure/retry and all three locales. Masked desktop/mobile screenshots were inspected for hierarchy, wrapping and overflow; private values were masked before screenshots and traces are disabled.
- Native targeted tests: **62 Rust tests** passed across desktop (11), application (24), domain (12), private protocol (6), framing (6) and control client (3). This includes native authorization cancellation/renewal guards, updater settings/confirmation, audio process-choice guards and IPC fixtures. Strict Clippy with warnings denied passed for desktop and the targeted portable crates. Loopback control-client tests required the same sandbox network access; denial was not treated as a source failure.
- Earlier product executable/persistence checks passed against owned disposable PostgreSQL: the standalone executable ran without source/node_modules from an empty directory, embedded migrations were idempotent, actual cookie auth/room creation worked, and control/product records survived a database restart. All temporary processes and databases were removed.
- `bun run test:media:product` passed the actual Rust SDK → browser E2EE worker/decoder fixture: decoded **720→480→720**, a fresh authenticated API grant and SFU reauthentication, encrypted synthetic Opus with correct-key signal energy above 0.005, wrong-key zero decoded video/audio, continued correct-key video and native exit 0. The combined test exposed a startup-relative fixture race: browser/audio negotiation could miss a fixed resize window. Bounded private test commands now trigger each resize after the preceding dimension is observed; packet restarts use actual IDR/SPS/PPS while timestamps remain monotonic. No codec, media policy, key rejection or timeout assertion was relaxed. The final deterministic run passed in 14.7 seconds (16.5-second runner). Synthetic H.264/440 Hz PCM uses no personal content, OS capture or hardware encoder.
- Deployment preparation passed explicit synthetic certificate/configuration fixtures, negative-input/overwrite checks and private file modes. Compose/Caddy configuration and release-script structure checks passed. No public DNS, TLS issuance, production deployment, actual signing key, signed installation/update or release publication was performed.

Local image rebuilding hit `ENOSPC` in the Docker filesystem (66.2 GiB used, about 256 MiB available). The failed production web build created no image. Only approximately 95 KiB of cache could be attributed unambiguously to that failed build; no global cache, image or volume was pruned. Image builds/runtime checks are moved to a fresh CI runner. Only this repository's regenerable incremental Cargo cache was removed. Builds use two Cargo jobs, one browser worker and capped owned PostgreSQL/SFU containers; existing services and volumes are preserved.

The preceding Windows CI runs prove their identified historical commits only. Current product Windows compilation, Windows-only process-loopback behavior, sidecar packaging and installer evidence must come from the new provider run. Physical Windows/GPU capture, minimized/game behavior, two-PC E2EE/audio, restrictive-network TURN and prolonged budgets remain unexecuted acceptance gates; portable/synthetic tests do not substitute for them.

### First product CI corrections

[Run 40494091695](https://github.com/jaovito/screen-share/actions/runs/40494091695) on `5f5b935` passed TypeScript/PostgreSQL, standalone/persistence, desktop/mobile E2E, encrypted browser media and code-owner policy. Both Rust jobs stopped on one newly added unformatted source-closed match arm; the local full `bun run check:rust` passed after `cargo fmt` corrected it.

Both complete Linux images built successfully on the fresh runner. API startup/migrations/readiness/authenticated SFU smoke and UID/CA/no-Node assertions passed. The production Caddy invocation then failed with `operation not permitted`: the upstream executable carried `cap_net_bind_service=ep`, incompatible with the empty capability bounding set. The Dockerfile now removes that file capability and verifies it is absent; production already explicitly permits unprivileged low ports through its namespaced sysctl. A tiny owned base-image layer passed `caddy adapt` as UID 10001 with all capabilities dropped, read-only filesystem and no network, and served a loopback-only health response on internal port 80 with the production sysctl. Only that temporary validation image was removed. Complete corrected-image/provider Windows results remain pending the next CI run.

The updated development PostgreSQL received the versioned migration through the regular migrator, preserving existing data/volumes. Only the identified old project API container was stopped; the current Bun source API now serves loopback port 3000. Readiness and unauthenticated session checks returned 200/null. The existing viewer on port 5175 remains running. No development user account or media session was created by these availability checks.

### Corrected-image and public-command verification

[Run 40494554760](https://github.com/jaovito/screen-share/actions/runs/40494554760) on `b161d93` passed the complete API and production viewer image job after the Caddy correction, including network-isolated unprivileged runtime checks, Caddy configuration and scanning the actual static output against generated CI credentials. Portable Rust and code-owner policy passed; Windows validation was still in progress at this snapshot. The public `bun run test:integration` command also passed **13 tests / 275 assertions across five real-database integration files** locally. Standalone executable and persistence checks were repeated successfully after the final product integration. Remaining legacy developer error strings and generated coverage HTML were translated to English with matching test expectations; pt-BR/es/en product catalogs remain localized.

### PLAN completeness corrections: diagnostics and same-source recovery

A final implementation audit identified code gaps rather than physical-test blockers: the quality advisor was not connected to the product, external processing timings were absent, resource invalidation ended capture rather than recovering the same item, and native stop/key-loss explanations were missing. These are now implemented, rather than being deferred as hardware acceptance.

The encoder records bounded conversion CPU submission time and accepted-input-to-matching-output latency, with two pending timestamps and a five-second rolling sample bound. Fresh SDK targets expire after 2.5 seconds. The visible advisor requires five seconds of continuous generation/profile/FPS-bound evidence and resets on pause, renewal, recovery, gaps and reconnect. It explicitly leaves application rendering activity unknown and does not identify GPU/codec saturation from combined latency or sparse static-scene frames.

Proven DXGI device invalidation retries the same WGC pool/item/session with three total attempts and 250/500/1000 ms backoff. A synchronized generation gate blocks stale output, retained audio pauses without source replacement, the encoder rebuilds behind a new parameter-set IDR gate, and lease/stop/pause checks remain active. Source closure, exhausted retries, unrelated errors and failed cleanup stop publication. No hardware reset was executed here.

Executed: full TypeScript/architecture/build checks and **155 coverage tests** (75 server/database + 80 DOM), **83 runtime files**, **99.23% lines / 96.84% functions**, retaining all per-file/inventory gates. Recovery/timing media tests passed thirteen portable cases; protocol passed seven; Windows-target strict Clippy compiled the actual WGC recovery APIs and four Windows metadata/generation tests. Desktop and native proof host strict Clippy, native RTC fourteen tests and all-target Clippy passed. The host proof check does not compile the Windows-only publisher pipeline; that needs the updated provider run.

The actual product diagnostic component was rendered in explicitly synthetic desktop/mobile browser fixtures; both layouts were inspected without overflow. The fixture showed processing-pressure advice after the real five-second UI evidence window. Temporary fixture sources/server/browser were removed. Synthetic displayed counters do not constitute Windows/GPU timing evidence.

The final regression repeated all eight desktop/mobile E2E flows successfully (38.7 seconds) and passed full portable `bun run check:rust`. The actual synthetic encrypted transport fixture additionally verified the same-profile recovery gate: after `require_keyframe`, an actual parsed non-IDR Annex-B packet was rejected with `KeyframeRequired`, then fresh parameter sets/IDR were accepted and browser decoding continued. Resizing, authenticated grant/SFU renewal, encrypted Opus, wrong-key zero audio/video and native exit 0 remained required; the combined run passed in 14.2 seconds (17.6-second runner). The independent recovery-boundary pass confirmed no new actionable issue.

The real synthetic transport regression also passed pause/resume (17.3-second test, 19.1-second runner). After draining accepted data, decrypted video frame count remained unchanged for 1.1 seconds and audio signal stayed below 0.00001; resume restored IDR-decoded video and audio above 0.005. The same run retained all resolution, signed-grant renewal, delta-frame rejection and wrong-key checks. The pinned SDK produced no new target while paused and a valid target after resume; no zero FPS/bitrate was observed. This is evidence for that run, not a universal SDK guarantee, and did not justify a production policy change. Only the bounded synthetic probe/test were extended.

The first provider check of the new Windows-only recovery pipeline (`e1dca45`, run 40497838123) compiled the integrated types and rejected two nested conditions under strict Clippy `collapsible_if`. The equivalent conditions were combined into a let-chain, preserving device-loss handling and retaining `-D warnings`; no lint was suppressed. This Windows-only source was not covered by the Mac proof check, as noted above. The corrected final provider run remains the acceptance evidence for that source.

### Complete provider validation and installer inspection

[Run 40499125813](https://github.com/jaovito/screen-share/actions/runs/40499125813) passed **all five checks** on `4c8a6fc`: TypeScript/PostgreSQL, portable Rust, both Linux images, Windows desktop and code-owner policy. Windows logs confirm the actual integrated capture/encoder/recovery pipeline passed strict Clippy; fourteen native RTC tests, nineteen media/probe tests, seven private protocol tests, ten publisher input/pacing/control tests and ten desktop tests passed in their respective steps. The optimized native sidecar and parent compiled, and NSIS produced `Screen Share_0.1.0_x64-setup.exe` (11.65 MiB). These hosted tests do not exercise GPU capture, application audio devices or physical two-PC playback.

The downloaded Actions artifact SHA-256 matched GitHub's recorded digest (`1ff4ac20deb074933819a78e56a41bee0b241ab201a81a04a8b4b2308b81af27`). An official SHA-256-verified temporary 7-Zip inspector checked the NSIS CRC without executing Windows binaries. The installer contains both `screen-share-desktop.exe` (13,734,912 bytes) and `ss-media-proof.exe` (30,685,184 bytes). Both are PE32+ AMD64; the bundled publisher contains the private `--desktop-control` entrypoint. Import-table inspection found no external VCRUNTIME/MSVCP, WebView2Loader or WebRTC DLL dependency. This is artifact-content evidence, not a clean-machine installation or Authenticode claim.

Final UI cleanup removes the prototype title from the helper window and hides the auxiliary picker owner after selection in the regular desktop flow, while retaining its STA message pump, selected item and lifetime. The standalone operator tool keeps its visible stop window. Windows-target strict Clippy passed; an additional Windows-only test creates the helper, hides it, verifies message-pump liveness and checks destruction. Its execution and the updated installer require the follow-up provider run. No browser/API behavior, authorization, source recovery or content key changes accompany this cleanup.


## 2026-10-27 — Integrated Windows receiver

Implemented ADR 0013: the desktop and web viewer load one public browser-safe E2EE
receiver package. Desktop account/grant requests retain native IPC/cookie transport.
The exact configured RTC origin and secure WebView scheme replace the previous
publication-only renderer policy. See [security review](security-review-desktop-receiver.md).

Local validation passed: `bun run check:ts` (strict types, architecture, unit/DOM,
production builds), `bun run test:coverage` (84 runtime files inventoried; 99.24%
lines, 96.95% functions overall, all per-file gates passed), all eight desktop/mobile
`bun run test:e2e` cases (39.3 seconds), and `bun run test:media` (real E2EE worker,
synthetic H264 decoding and wrong-key rejection; 5.0-second test). Native macOS
validation passed 15 desktop library tests, strict desktop Clippy and workspace
formatting with two Cargo jobs. Twelve synthetic release RTC-input cases passed.
Independent static security review found no confirmed actionable issue in scope.

Actual Windows WebView2 regression is configured with owned synthetic metadata,
H264/Opus and a pinned real SFU. Its provider result remains pending at this entry;
local browser playback and Mac compilation do not establish Windows execution.
Physical GPU/capture, two-PC/TURN, prolonged operation and signed-install/update
acceptance remain unexecuted gates.


### Windows receiver CI failure investigation

[Run 40524158081](https://github.com/jaovito/screen-share/actions/runs/40524158081)
passed TypeScript/PostgreSQL, portable Rust, both images and owner policy on
`205889f`. Windows native checks and NSIS packaging succeeded; the actual receiver
fixture failed with `EPERM` while removing its owned temporary directory. Because
cleanup threw from `finally`, the earlier fixture error was hidden. This run does
not establish working WebView2 playback.

The correction awaits process closure, attempts every cleanup independently and
preserves the original failure. A bounded native Windows remover handles the
filesystem fallback. Four regressions cover ordered async release, original-error
preservation, cleanup continuation and failure propagation. Local TypeScript checks
and database-backed coverage passed (84 runtime files inventoried, all per-file
gates passed). Actual Windows probe/playback remains pending the corrected provider
run; no encryption/CSP assertion or acceptance gate was removed.


[Run 40550399468](https://github.com/jaovito/screen-share/actions/runs/40550399468)
confirmed the preliminary Windows SFU/H264/Opus probe, all native checks and NSIS
packaging. Cleanup completed without masking the original error. The full fixture
failed while waiting for the application's WebView2 CDP endpoint, before playback.
Pinned Tauri 2.12.3 runtime source displays a blocking release-build dialog when
WebView2 Runtime is unavailable; the runner's Edge browser does not establish that
prerequisite. The fixture now explicitly detects/provisions the official signed
Evergreen runtime and records its version. Runtime connection/playback must still
pass the next provider run. The saved Rust cache avoids rebuilding unchanged native
dependencies for that retry.

Additional local checks passed: all eight E2E cases (38.9 seconds), actual owned
process shutdown/repeated stop/temp-directory removal, and synthetic browser probes
confirming that video.load resets the decoded-frame counter and the audio analyser
processes its source. These probes falsified two possible assertion defects; they
do not establish WebView2 behavior.


Run 40564069076 stopped early in the preliminary publisher with `could not establish
pc connection`; the same loopback fixture had succeeded on the preceding provider
run. To isolate WebView playback, this owned synthetic fixture now explicitly forces
the pinned SFU's ICE/TCP test mode. Encryption, codec, decoded-media and wrong-key
assertions remain mandatory. UDP/TURN and real-network acceptance remain separate
and unexecuted by this fixture.


Run 40564818047 demonstrated that forcing TCP alone did not repair the hosted
loopback ICE negotiation. The next fixture revision advertises only the hosted
runner's own enumerated RFC1918 IPv4 with an exact /32 filter, while HTTP/signaling
remain loopback. It does not contact LAN peers or external infrastructure. Three
address-selection regressions passed, including rejection of public/malformed/absent
interfaces. Runtime detection/installation now happens in the preliminary probe so
missing prerequisites fail before native compilation. No application security or
media assertion was relaxed.


Run [40565514989](https://github.com/jaovito/screen-share/actions/runs/40565514989)
confirmed the owned-interface Windows H264/Opus publisher probe, native checks and
NSIS packaging. WebView2 Runtime 155.0.4283.62 was already installed, disproving the
missing-runtime hypothesis above. The full application still timed out waiting for
CDP, before playback. Microsoft documents that WebView2 150+ ignores `WEBVIEW2_*`
environment configuration in elevated hosts; the test previously relied on those
variables. The fixture now supplies browser arguments and an isolated app-data path
through Tauri's compiled API configuration, preserving the original HTTPS window.
Two regression tests cover preserved settings, invalid inputs and local-only
loopback flags. Local TypeScript checks and database-backed coverage passed; the
actual Windows playback result remains pending the provider retry.


Provider [run 40571179784](https://github.com/jaovito/screen-share/actions/runs/40571179784)
passed all five required checks at ef98a24. Actual Windows WebView2 155 decoded
synthetic encrypted H264 video and Opus audio, rejected the wrong key, enforced
secure context/exact-origin CSP and released sinks on stop. NSIS packaging passed.
Its ordinary CI installer uses local development endpoints.

A subsequent operator-requested Railway installer uses manual CI inputs for public
API/RTC origins, verifies their presence in the compiled parent and records the
installer SHA-256/revision alongside the artifact. This is an unsigned environment
build, without release publication or signing. Provider execution and the manifest
remain the evidence for the resulting artifact; hardware/two-PC gates remain open.


[Configured build 40609560315](https://github.com/jaovito/screen-share/actions/runs/40609560315)
passed Windows compilation, NSIS packaging, compiled-origin verification and actual
WebView encrypted playback. The downloaded installer SHA-256 matches its manifest;
the API is `https://screen-shareviewer-web-production.up.railway.app` and RTC is
`wss://screen-share-jkvwb9d3.livekit.cloud`. The public API readiness endpoint returned
ready and the anonymous auth session returned null. A separate TypeScript job failed
only on YAML empty-string quote formatting; that formatting was corrected locally.
This result does not claim a signed installer or a live user capture/account test.


## Publisher startup failure diagnostics (2026-10-27)

A user reported the generic stopped message with no diagnostic reason. Code tracing
confirmed that command rejection discarded the error and replaced the reason with
null. The publisher now retains a bounded stage/code for rejected start, renewal,
status, pause, resume and stop operations. Only exact application-owned native codes,
allowlisted HTTP statuses and fixed validation/abort/fallback labels are displayed;
raw rejection strings, validation inputs, tokens and keys are never rendered.
Status polling preserves the failure until an explicit successful command.

Regression tests cover native failure persistence across actual timer polling,
successful retry clearing, HTTP 409 before native startup, cleanup and unknown-error
redaction. Local TypeScript checks and per-file coverage passed (85 runtime sources
inventoried). The first E2E attempt overlapped the TypeScript build and was invalidated
by its rewritten local API origin; the serial retry passed all eight desktop/mobile
E2E cases (37.9 seconds).
The original Windows capture/publication failure remains unidentified pending the
new diagnostic code from the user's hardware; this change does not claim to fix it.

## Native post-selection failure preservation (2026-10-28)

An operator reported an RTX 3070: selection succeeded, the app showed connecting,
then stopped with five captured frames, zero encoded access units and `worker_failed`.
These are operator observations, not a local GPU measurement. Code tracing confirmed
that actual capture starts only after the publication worker signals readiness.
The previous UI fix covered rejected IPC commands; this failure arrived through a
successful status response after the worker had started.

The native session collapsed all worker result errors into `WorkerFailed`. Worker
and session cleanup could also replace the original media error. The correction
preserves the first encoder failure and original media result while still attempting
all cleanup. Optional closed failure metadata crosses the existing native status
boundary: stage, enum code, allowlisted operation and signed numeric HRESULT. COM
error descriptions, frame content, keys, tokens and arbitrary SDK text are excluded.
Older status packets remain compatible. The shared Rust/TS fixture and rejection
cases validate the extension, and the UI renders post-startup failure metadata even
when IPC succeeds. Native MF/GPU calls retain operation/HRESULT instead of erasing
those values. Encoder settings and selected-source behavior are unchanged.

Local TypeScript checks, portable Rust checks, Windows-target media Clippy, shared
contract tests and all eight E2E cases (38.4 seconds) passed. The initial portable
Rust attempt lacked sandbox loopback permission; the authorized retry passed. The
first database coverage attempt crossed a real minute boundary in the existing
authentication-throttling test (11 requests split between buckets). Its bounded
21-request retry now covers either side of one boundary without changing production
limits. The full coverage retry passed: 86 runtime sources inventoried, 99.26%
lines and 96.98% functions overall, with every per-file gate satisfied. Actual
provider Windows evidence remains a separate run; this entry does not claim the
RTX hardware issue is resolved.

Primary API references checked against this implementation:
[asynchronous MFT processing](https://learn.microsoft.com/en-us/windows/win32/medfound/asynchronous-mfts),
[hardware-only enumeration](https://learn.microsoft.com/en-us/windows/win32/api/mfapi/nf-mfapi-mftenumex),
[encoder low-latency property type](https://learn.microsoft.com/en-us/windows/win32/medfound/codecapi-avlowlatencymode).

Provider [run 40695151122](https://github.com/jaovito/screen-share/actions/runs/40695151122)
passed all four dispatched jobs at 3263560, including the Windows native failure
fixture, first-error/HRESULT preservation regression, NSIS packaging, compiled public
origin verification and actual encrypted WebView2 playback. The downloaded Railway
installer SHA-256 is `b4ab0846b6f4b1c79e7394077a643c6112a5f39701f6d3a3b995ac6a3694f63e`.
This validates the failure propagation code and synthetic playback, not the
operator's RTX 3070 capture/encoding acceptance, which still requires a rerun there.

## RTX 3070 optional B-picture property rejection (2026-10-28)

The operator's new native diagnostic identified the exact startup rejection:
`encoder_initialization / native_call_failed / mf_b_frames / 0x80070057`.
The call used the documented UINT32/VT_UI4 zero value, but the hardware MFT rejected
that optional CodecAPI property. This was a redundant prerequisite: the application
already explicitly requests H.264 Baseline, whose B-frame count is always zero.

The correction removes the B-picture setter, retains mandatory low-latency mode,
CBR/bitrate setup and explicit Baseline output selection, and rejects non-Baseline
or truncated SPS parameter sets before publishing them. The check applies to both
initial headers and later in-band parameter changes; it does not silently select a
different source, software encoder or encoding profile. Synthetic framing fixtures
now contain actual minimal Baseline profile bytes instead of placeholder SPS bytes.

A regression rejecting Main/Extended/High-family SPS at startup and midstream failed
before the guard and passed afterwards. All 15 portable media tests, full portable
Rust checks and strict Windows-target media Clippy passed locally. The provider
Windows installer and an operator rerun on the RTX remain separate evidence.

References: [B-picture property type/support](https://learn.microsoft.com/en-us/windows/win32/codecapi/avencmpvdefaultbpicturecount-property)
and [Microsoft H.264 Baseline/B-frame behavior](https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder).
