---

name: ss-verify
description: "Validate a monorepo change with Bun/Rust checks, per-file coverage, disposable PostgreSQL, E2E, and evidence proportional to the diff."
---

# Verify a delivery

Read [AGENTS.md](../../../AGENTS.md), [testing.md](../../../docs/testing.md), the diff, and current [package.json](../../../package.json) scripts. Check required tools without printing secret configuration. Record new delivery evidence in [validation.md](../../../docs/validation.md); historical results do not prove the current change. Keep reports/documentation in English.

Select checks by affected code:

| Change                            | Verification                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Instructions/docs only            | Local links, commands/examples, plan/code consistency, and affected configuration schemas; do not repeat product suites without behavior changes |
| TypeScript/contracts/tooling      | `bun run check:ts` and `bun run test:coverage`                                                                                                   |
| SQL/persistence                   | Real integration included in coverage; `bun run test:persistence` for durability/restart changes                                                 |
| Portable Rust                     | `bun run check:rust`; IPC changes also need fixture and Windows gate                                                                             |
| UI flow/runtime/build/browser     | `bun run test:e2e`; layout requires desktop/mobile visual inspection                                                                             |
| Image/Compose/production          | Image build and smoke/readiness of the authorized composition; final API is the standalone Bun executable                                        |
| Windows shell/capture/encoder/RTC | Windows checks and the PLAN.md experiment; portability cannot replace hardware evidence                                                          |

For combined TS/Rust changes, `bun run check` aggregates checks/coverage; do not repeat its steps without reason. Coverage uses Docker/disposable PostgreSQL. E2E requires installed Chromium and pinned Bun; it starts the API directly from TypeScript. Use bun run test:binary to verify the compiled executable with embedded migrations in an isolated working directory. Missing tools mean a blocked check, not a mocked replacement for announced integration.

Coordinate runners that clear reports or manage processes: one owner runs coverage/E2E per checkout. Never use a shared database as a fixture or stop servers found by port. Scripts own their resources and preserve development volumes.

Require 80% lines/functions per file and complete inventory; gate failures must propagate nonzero exit. Never lower thresholds, hide sources, or change exclusions to pass. Inspect behavioral evidence beyond percentages. Report TS, Rust, browser, Windows, and media separately.

State command, outcome, and material limitations, distinguishing passed, failed, and not run. Never claim remote CI, a Windows bundle, E2EE, or real streaming without corresponding execution.
