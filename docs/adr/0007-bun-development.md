# Bun for development, workspaces, and tests

Status: accepted after user-requested evaluation · 2026-10-26. Supersedes development pnpm/Node choices in ADRs 0001/0006; preserves Node for the published API.

**Later update:** ADR 0008 superseded retaining Vitest after another user request/evaluation. The evidence below records the preceding stage.

**Later runtime update:** ADR 0010 supersedes retaining Node for the API; the original decision/evidence below remain historical.

## Local evidence

Same Vitest 5.0.5 suite, 32 tests, three alternating runs on macOS arm64. Total time includes startup; caches were not cleared. Data: docs/benchmarks/bun-2026-10-26.json.

| Executor     | Runs (s)              | Median (s) |
| ------------ | --------------------- | ---------- |
| Node 24.22.1 | 3.344 / 1.800 / 1.977 | 1.977      |
| Bun 1.4.3    | 1.718 / 0.802 / 0.916 | 0.916      |

The sample shows about 54% less total time, approximately 2.16x in this scenario. It does not prove equivalent Docker/Rust/Chromium/database/production speedups. Workers were confirmed to run Bun, not just the parent command.

## Decision

Adopt Bun 1.4.3, already available and used in Truco, for workspace management and scripts/Vite/Vitest/Playwright. Generate bun.lock with the tool and install frozen. Disable import auto-install; lifecycle scripts only for explicitly trusted dependencies. Installation is not typechecking, which remains separate.

Retain Vitest, fixtures/isolation, and existing coverage. The complete database suite passed under Bun (33 tests, 98.70% lines, 96% functions); inventory/per-file 80% thresholds remain. A temporary 100% threshold failed with nonzero exit, testing the negative path. Branch metrics differ between executors and are not used for performance comparison or weaker policy.

Published API remains Node LTS with Hono's Node adapter and pg. Development uses Bun's Node compatibility; E2E starts compiled API with Node. Images use Bun only for installation/build and unprivileged Node in the final stage. A production server change requires its own decision/validation.

## Limits

At this stage native Bun Test was not selected: use bun run test, because bun test does not read Vitest configuration. Tools explicitly use bun --bun rather than relying on Node shebangs. Browser/domain code stays free of Bun APIs. Only measured Bun 1.4.3 is claimed, not later versions.

Local success does not confirm remote CI, Windows shell, or media. Windows remains a required gate. Node stays installed for production API, E2E, and tools requiring it.

## References

- [Bun workspaces](https://bun.sh/docs/pm/workspaces)
- [Bun install/trustedDependencies](https://bun.sh/docs/pm/cli/install)
- [Node compatibility](https://bun.sh/docs/runtime/nodejs-compat)
- [Vitest test environments](https://vitest.dev/guide/)
