# Bun API runtime, standalone builds, and extensionless aliases

Status: accepted at the user's request · 2026-10-26. Supersedes the Node API runtime/emitted-contract choices in ADRs 0001/0006/0007/0008 while preserving pure-domain boundaries, data validation, and milestone scope.

## Context

The user requested app-scoped tsconfig aliases, extensionless imports, direct TypeScript API execution on Bun, and standalone Bun builds instead of generated API JavaScript. Bun already runs development/tests and its pinned release supports native HTTP, path resolution, compilation, and directory embedding.

## Decision

Use TypeScript module Preserve/moduleResolution Bundler and noEmit. Frontends define `@features/*`, `@app/*`, `@shared/*`; API defines `@modules/*`/`@runtime/*`. Vite enables resolve.tsconfigPaths; Bun resolves API/test paths. Keep short local relative imports and public @screen-share workspace exports. Contracts export source TS without an emitted build. Architecture checks resolve aliases and still reject private feature imports, outward domain/application dependencies, and cycles.

Run the API source on Bun by default with native Bun.serve; remove the Node server adapter. Preserve liveness/readiness, sanitized logs, bounded retries, graceful request drain, pool closure, and forced shutdown deadline. Runtime-specific APIs stay in runtime/adapters, never pure domain/application rules.

An explicit build uses Bun build --compile for one executable with serve/migrate/smoke/ready commands. Embed versioned drizzle SQL/meta directories so migrations/readiness work without source, node_modules, or a particular CWD. Disable automatic dotenv/bunfig loading in the executable; supply validated runtime environment. Rebuild whenever migration history changes. No environment secrets are embedded.

Docker compiles for its Linux architecture and copies only the executable into a digest-pinned minimal Debian runtime with CA certificates/libstdc++, running as app. No Node or dependency tree is required in the final image. Frontends still produce browser JavaScript through Vite.

## Alternatives and consequences

Keeping Node would require extension-aware ESM output or another bundling step and conflict with the user's runtime preference. A duplicate Vite alias map could drift from tsconfig; native path support avoids another plugin. Three separate CLI executables would embed Bun three times, so one command dispatcher is used instead.

The executable embeds Bun and dependencies and is substantially larger than TS source; it is a distribution artifact, not a source-check prerequisite. Host builds are platform-specific. Do not copy a macOS executable into Linux or claim untested Windows/cross-target behavior. Native HTTP unit tests require ephemeral loopback sockets; restricted sandboxes must permit them explicitly. No capture, authentication, E2EE, or production exposure is added.

## Verification

Typechecks, architecture regressions, coverage/inventory, source-API E2E, a standalone check in an empty temporary directory with disposable PostgreSQL, and Linux image/Compose smoke validate distinct paths. Preserve historical benchmarks rather than claiming Bun production performance from test timings. Record actual results and unexecuted gates in docs/validation.md.

Primary sources: [Bun TypeScript](https://bun.sh/docs/runtime/typescript), [native HTTP](https://bun.sh/docs/runtime/http/server), [standalone assets](https://bun.sh/docs/bundler/executables), [Vite tsconfig paths](https://vite.dev/config/shared-options#resolve-tsconfigpaths).
