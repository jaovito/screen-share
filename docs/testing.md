# Tests, coverage, and development

The policy adapts ~/www/truco practices to this stack. Native Bun Test (bun:test) is the only unit/DOM/integration runner; Playwright covers browser behavior and Rust uses cargo test. Vitest/its provider were removed after ADR 0008. Use bun run test to coordinate isolated backend/DOM suites. Direct bun test selection needs the DOM preload where applicable; SQL tests need the runner's disposable database.

| Command                           | Scope                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| `bun run lint`                    | Biome lint and architecture boundaries                          |
| `bun run format` / `format:check` | Format / check without changing files                           |
| `bun run typecheck`               | Contracts, apps, DOM/API tests, scripts, tooling, configs, E2E  |
| `bun run test` / `test:unit`      | Unit/DOM tests without Docker                                   |
| `bun run test:integration`        | Migrations/constraints/readiness with disposable PostgreSQL     |
| `bun run test:persistence`        | Data/migration history after disposable database restart        |
| `bun run test:coverage`           | Unit/DOM/SQL tests with per-file thresholds and inventory       |
| `bun run test:e2e:install`        | Install Playwright-managed Chromium                             |
| `bun run test:e2e`                | Real API/database, isolated production previews, desktop/mobile |
| `bun run check:ts`                | Lint/types/architecture/unit/DOM/builds, without Docker         |
| `bun run check`                   | TS, portable Rust, complete coverage; requires Docker           |

## Organization and behavior

Frontend tests live near the page/hook/service behavior they exercise. Decorative components already covered by composition need no redundant isolated test. API regressions live in apps/control-api/test; .integration.test.ts selects database cases. Tooling policy tests live in tooling. E2E tests use tests/e2e/<feature>/*.e2e.ts; introduce shared support only with actual reuse.

Current cases cover catalog validation, liveness/readiness separation, sanitized configuration errors, unavailable database, repeated SQL, constraints, reconnection, bounded retries, shutdown, smoke, viewer loading/retry/error/cleanup, and unavailable/invalid desktop IPC. Fake clocks avoid real timeout waits. Real network/database calls have deadlines. Write test descriptions/comments in English; assertions may retain Portuguese UI/runtime strings.

E2E uses a disposable database, free ports, and owned processes without reusing existing servers or touching development data. The product flow uses real cookie authentication, disposable PostgreSQL and an owned SFU to exercise room creation, invitations, approval, grants/session transitions and revocation. Synthetic credentials belong only to that run. Controlled error cases and browser-preview checks do not prove hardware capture or arbitrary network connectivity. Desktop browser preview does not prove the Windows shell/capture.

The E2E runner builds interfaces with its own public API URL. reuseExistingServer: false avoids using another app accidentally. Traces are retained on failure; HTML lives in playwright-report and screenshots in test-results. `bun run test:e2e -- --project=chromium` selects desktop. Success screenshots allow visual review alongside geometry assertions.

## Required coverage

Minimum: **80% lines and 80% functions per executable file**, configured in bunfig.toml and explicitly checked by tooling/coverage/lcov.ts. The parser compares exact counters before rounding and checks every file occurrence in every suite. High averages cannot compensate for low-coverage files. This runner does not claim statement/branch coverage; decision cases still require tests/review. Critical behavior remains mandatory regardless of percentages.

The runner clears root coverage, creates dedicated PostgreSQL, and measures backend/SQL and DOM in separate processes with per-file --isolate. Inventory covers all apps/*/src and contracts; the architecture analyzer is also measured. Missing executable modules fail inventory, including sources never imported by tests. Reports include native text/LCOV per suite, aggregate LCOV, JSON summary, and coverage/index.html per-file summary with uncovered line numbers. Files with no own functions display an em dash, without invented counters. Native percentages are not directly comparable to V8/Vitest. Playwright/Rust are not added to them.

Explicit exclusions: tests/fixtures, TypeScript declarations, configuration/execution infrastructure, and one minimal API CLI entry, src/index.ts. It invokes the measured command dispatcher and assigns exit codes. **All server/migration/smoke behavior** was extracted to measured src/runtime services; frontend entrypoints remain measured. Never move behavior into exclusions to raise coverage. Operational scripts are not product coverage denominators; they are typechecked and their flows are verified through bootstrap/doctor/integration/E2E.

Tooling coverage source remains versioned: only root/app/package coverage reports are ignored. Inventory has a regression rejecting absent executable source and accepting type-only files. Never import modules solely to inflate coverage, lower thresholds, or add silent exclusions.

## Documentation-only changes

For docs, AGENTS.md, agents, and skills without executable changes, validate links, cited commands, plan/code consistency, and affected configuration schemas. Product coverage/E2E need not rerun merely for instruction edits. Scripts/tooling/behavior changes require the appropriate checks. See [agents.md](agents.md).

## CI and limits

Linux runs TS checks, disposable-database coverage, persistence, and desktop/mobile Chromium E2E. Reports are uploaded as artifacts including failures. Separate jobs preserve portable Rust, Windows shell, and image/Compose checks. Missing Docker/Chromium fails explicitly rather than producing silently skipped green tests.

CI configuration alone cannot confirm provider execution. Windows compilation/tests, interactive hardware execution and two-PC media acceptance are separate evidence; consult the dated validation log for the exact executed revision. TS coverage does not establish numeric Rust coverage, WebView2 behavior, encoding, WebRTC, or E2EE.

Native migration preserves per-file gates/reports. Regressions reject below-80% modules despite high aggregate coverage, invalid counters, and values rounded up to 80%. A temporary 100% native threshold was also confirmed to exit nonzero. Vite/Playwright explicitly use bun --bun; E2E API runs TypeScript directly on Bun, matching the default source runtime. The standalone executable has a separate disposable binary check. See ADRs 0007/0008.

## Native Bun Test equivalence and isolation

scripts/test-suites.ts discovers backend/DOM suites; .integration.test.ts is included only with a disposable database. bun run test typechecks source contracts and runs the discovered unit/DOM suites; coverage adds real SQL integration. Current counts belong in the dated validation log rather than this command contract. Environments/preloads are separated and each file uses --isolate so module mocks/globals do not leak across files.

Mocks use mock, mock.module, and spyOn, registering module mocks before dynamic import of the exercised module. Timers use Bun's synchronous jest APIs and explicit microtask draining; no Vitest shim is installed. Mounting tests use a distinct module identifier for the missing-root case rather than vi.resetModules. DOM preload registers Happy DOM before React Testing Library and cleans up/restores spies after each test.

Local timings were equivalent, with the native workflow including a historical contracts build and three extra tests. Removing Vitest/provider simplifies the stack without claiming extra speed. Typechecking remains mandatory because executing TypeScript does not validate types.


## Localization regressions

UI tests use the real localization provider/resources rather than mocking translation calls. DOM cleanup clears localStorage to isolate locale preferences between tests. Tests exercise canonical/invalid preferences, blocked browser storage, language changes during a pending response, metadata, persistence across remount, and unchanged HTTP/IPC counts. E2E covers selector/reload behavior in the three viewer locales and English/Spanish desktop preview on desktop/mobile Chromium. Unit/DOM descriptions remain English; assertions use the selected target language.


## Bun API source and executable checks

The default API runs TypeScript on Bun without compilation, and source-based contracts require no emitted dist files. Native HTTP tests open an ephemeral loopback socket; a sandbox restricting sockets must permit this action rather than skip the test. Tests cover graceful drain, repeated shutdown, forced deadlines, bind/database-close failures, command validation, and readiness without migrations.

`bun run test:binary` builds the host executable, copies only that executable into an empty temporary directory, migrates a disposable PostgreSQL database twice, verifies readiness, the catalog and authenticated private-product behavior while denying unauthenticated grant requests, and requires successful SIGTERM shutdown. This proves embedded SQL/journal lookup independently of source/CWD/node_modules. It does not establish cross-platform execution: macOS/Linux results cannot stand in for Windows. CI runs this check separately from coverage/E2E.

Architecture regressions include alias-based private imports, shared/app/feature direction, domain/application adapter restrictions, and cycles. Typechecking uses module Preserve/moduleResolution Bundler with noEmit; Bun execution is not typechecking. Frontend builds remain Vite browser bundles.


## M1 experimental receiver and native boundaries

`bun run test:media` uses a separate disposable LiveKit container, synthetic credentials, a test-only 320×180/5 FPS canvas publisher, the real SDK encryption worker, and one Chromium worker. Its correct-key viewer must decode multiple frames; its wrong-key viewer must decode none while the correct client continues. It does not use capture hardware, normal local services, or the development database. Resources/configuration are owned and cleaned up by scripts/test-media.ts. No trace/screenshot records credentials or synthetic media in this proof. See media-proof.md.

Unit/DOM cases cover grant scope/allowlist/unsafe signaling, independent secrets, private exclusive files, explicit consent, cleared form values, lazy loading/cancellation, supported encryption, verified identity/room before subscription, unexpected media, timeouts, expiry, disconnect/collapse/unmount and SDK cleanup exceptions. Per-file gates apply to every measured occurrence; operator-only input schemas live in tooling rather than the browser client contract.

Rust tests add explicit source/session/epoch invariants, trusted-clock expiry across delayed authorization/preparation/start/resume/pause, idempotent/failed cleanup, bounded concurrent frame ownership, and H.264 access-unit framing limits. The Windows-target WGC implementation has a cross-target strict clippy check; that is API/type evidence, not an executed Windows capture or two-PC test.


## Current product and image validation

Shared React workspace tests run in the DOM suite, while authentication/room/grant rules and SQL concurrency run through their appropriate server/disposable-database suites. Regressions cover memory-only keys, invitation history/revocation, polling failures, stale responses, explicit local application-audio selection, PID/creation-time binding, continuous grant renewal, metrics and updater consent. No numeric coverage gate is lowered for these modules.

The Linux image job builds/starts the actual compiled API composition, checks readiness and authenticated SFU control, and verifies its UID/CA bundle/no-Node/no-node_modules runtime. It separately builds the production viewer with a public test API origin, checks the Caddy runtime and configuration in network-isolated containers, and scans copied static assets against generated CI database/auth/SFU credentials. It never provisions a production certificate, domain or public listener. Build-container CPU/memory limits are applied when the installed Buildx exposes its resource flags; runtime inspection is explicitly capped. Cleanup removes only that job's own inspection container/image.

The Windows job prepares the fixed sidecar before strict parent Clippy, IPC tests and NSIS packaging. Configuring these gates does not prove the run succeeded or that GPU/audio devices work. Signed release preparation remains manual and independently protected; CI development installers are unsigned. See [releases](releases.md).

## Native processing and same-source recovery regressions

Portable timing tests cover the external encoder's two-input bound, matched monotonic output timestamps, finite rolling observations and reset behavior. Pure recovery tests cover immutable source identity, three session-total attempts/backoff, pause/revocation/cancel gates, clock regression and strict recoverable DXGI HRESULTs. Windows-gated metadata tests exercise stale-generation, terminal source closure and the synchronized publication gate. Cross-target Clippy validates these Windows APIs but does not execute graphics recovery.

The visible publisher advisor and DOM tests cover continuous evidence windows, processing latency versus GPU/codec attribution, transport pressure, missing source activity, pause/generation/gap resets, allowlisted native stop reasons and safe active-session key-loss recovery. Browser screenshots use an explicitly synthetic component fixture for visual inspection; these displayed values are not hardware measurements. Actual Windows device-loss/recovery and prolonged timing observations remain hardware acceptance.


## Actual Windows application reception

`bun scripts/test-desktop-receiver.ts` requires Windows and the already-built desktop
UI/sidecar. CI runs it after producing the ordinary NSIS artifact. It rebuilds only
the standalone parent with owned loopback API/RTC origins and Tauri's custom-protocol
feature; the previously packaged installer retains its normal configuration.

The harness verifies the SHA-256 of the official pinned LiveKit Windows archive,
starts its own SFU, uses a unique WebView2 profile and test-only remote-debugging
port, and drives the actual application through Playwright CDP. Synthetic canvas
H264 and oscillator Opus feed the real E2EE worker. Assertions cover secure context,
CSP rejection of an unrelated origin, decoded frames/audio, wrong-key rejection and
detached sinks after stopping. Loopback ICE and autoplay flags apply only to these
owned test processes; no source capture, microphone or user media is accessed.

The metadata API is an explicitly controlled fixture with an HttpOnly cookie. It
verifies native IPC/cookie routing, not production authentication or SQL, which are
covered separately by the real product E2E suite. The test owns and cleans up its
process trees, files and ports. It does not establish physical capture, restrictive
network/TURN, two-PC connectivity or prolonged playback acceptance. See
[validation.md](validation.md) for actual execution evidence.

The Windows receiver fixture awaits owned process termination before removing its
temporary directory. Cleanup attempts every release and preserves the original
failure when cleanup also fails. Windows uses a bounded native removal fallback
for archive attributes/filesystem locks. Failed runs retain only a static stage
label and a screenshot of the synthetic WebView fixture, with no request trace.

CI first runs `bun scripts/test-desktop-receiver.ts --publisher-only` to validate
the Windows SFU and synthetic H264/Opus transport before the expensive native build.
This preliminary probe does not replace the actual WebView2 playback assertions.
The ordinary NSIS artifact and bounded Rust build cache are saved before the full
runtime test, so a runtime failure remains visible without discarding build evidence.

The full Windows application fixture explicitly checks the Microsoft-documented
WebView2 Runtime registry keys. When absent on the disposable host, it downloads
the official Evergreen bootstrapper, verifies its Authenticode Microsoft publisher
signature, installs it under a bounded deadline, and records the resulting runtime
version. Edge Stable is not a substitute for WebView2 Runtime. This setup is confined
to the authorized Windows test host and does not alter application CSP/E2EE. See
[Microsoft runtime distribution guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).

The Windows application fixture explicitly forces SFU ICE/TCP. HTTP/signaling stay
on loopback. On GitHub-hosted Windows, media advertises only an RFC1918 IPv4 actually
enumerated on that same runner, filtered to its exact /32; it never targets a LAN
peer or external SFU. Local operator runs retain loopback. This avoids rewriting a
non-loopback ICE interface to 127.0.0.1. Address-selection regressions reject public,
malformed and absent interfaces. These checks do not substitute for production UDP,
TCP fallback or restrictive-network TURN acceptance.
