# Native Bun Test

Status: accepted after further user-requested evaluation · 2026-10-26. Supersedes Vitest in ADRs 0006/0007, preserving organization, security, and production Node runtime.

## Evaluation

The existing 32 unit/DOM scenarios passed after native API adaptation. Three LCOV-policy tests were added. Three alternating runs on macOS arm64/Bun 1.4.3 excluded coverage/database/E2E and did not clear caches. Data: docs/benchmarks/bun-native-2026-10-26.json.

| Workflow                                    | Runs (s)              | Median |
| ------------------------------------------- | --------------------- | ------ |
| Vitest on Bun, 32 tests                     | 1.052 / 0.696 / 0.690 | 0.696s |
| Native Bun Test, 35 tests + contracts build | 0.783 / 0.727 / 0.696 | 0.727s |

Results were effectively tied and workflow costs differ. No additional acceleration is claimed. The benefit is unifying tools on the chosen runtime and removing Vitest/provider while retaining quality/coverage.

## Decision

Use bun:test native mocks, fake clocks, and imports after mock registration. Backend/DOM run in separate processes, each file with --isolate. Happy DOM preload precedes React Testing Library. bun run test is the main workflow; direct DOM selection needs the preload.

Coverage uses native text/LCOV, 80% lines/functions thresholds, explicit per-file exact-counter checks, and inventory. Preserve HTML summary with uncovered lines, JSON, and aggregate LCOV. Averages cannot compensate for low-coverage modules; invalid counters/reports fail. Percentages are not directly comparable to V8/Vitest.

The complete suite includes disposable PostgreSQL and measured runtime behavior with the same justified wrapper/infrastructure exclusions. Playwright remains E2E runner. Executing .ts does not validate types; separate checks include Bun types only in scripts/tests.

## Limits and validation

Native runner lacks some Vitest APIs; tests were adapted without a compatibility layer. Regressions verify per-file thresholds/negative paths. Remote CI and Windows shell remain pending; no new media, E2EE, or production Bun claims.

References: [mocks](https://bun.sh/docs/test/mocks), [DOM](https://bun.sh/docs/test/dom), [isolation](https://bun.sh/docs/test/parallel), [coverage](https://bun.sh/docs/test/code-coverage).
