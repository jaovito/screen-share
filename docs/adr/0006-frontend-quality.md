# Feature organization, TypeScript scripts, and test policy

Status: accepted at the user's request · 2026-10-26.

## Context

The user requested local ~/www/truco organization/readability/testing conventions and replacing MJS scripts with TypeScript. At that stage the project used Node LTS, pnpm, Vitest, and Rust/Tauri.

## Decision

Adopt app/features/shared, public feature APIs, nearby tests/styles, app CSS manifests, size limits, and Oxc import checks. Configure Biome with 2 spaces, width 100, single quotes, trailing commas, and logical-block blank lines. Keep API hexagonal and Rust domains pure.

Execute authored .ts scripts using pinned Node 24, restricting syntax to erasable types with separate typechecking. Preserve pnpm/Vitest to avoid another manager/runtime/runner without need; Bun was unnecessary for that requirement. Later decisions supersede this tooling choice in ADRs 0007/0008.

Configure Vitest/Happy DOM/React Testing Library with V8 coverage of at least 80% lines/functions per file and source inventory. Tests use disposable PostgreSQL. Playwright uses production builds, real API, Chromium desktop/mobile, and isolated ports. Full checks include coverage and require Docker; E2E remains separate.

## Consequences

Central rules live in AGENTS.md, docs/frontend.md, and docs/testing.md. Profile/status styles and IPC diagnostics belong to features; shared visual tokens/components remain in packages/ui. No gameplay, PixiJS, authentication, or Truco-specific stack rules are copied.

The three minimal API CLI entrypoints are excluded from product coverage; all their behavior was extracted into measured src/runtime services. Reports/traces remain local/CI artifacts, while tooling source stays in Git. TS coverage, web E2E, and Rust checks do not establish capture, E2EE, or Windows-shell behavior.
