# Contributing to Screen Share

Thank you for contributing. This project is at M0: repository/control/UI infrastructure works locally; capture, real streaming, authentication, and E2EE remain future milestones. Read [PLAN.md](PLAN.md) before starting work that changes product scope.

## Before coding

- Search existing [issues](https://github.com/jaovito/screen-share/issues) and PRs. Use an issue to discuss large features, architecture, media integration, or changes to a milestone gate.
- Small, well-scoped bug fixes and documentation improvements can go directly to a PR. No internal ticket system or employee account is required.
- Report suspected vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

## Local setup

Fork the repository on GitHub, then clone your fork:

```sh
git clone https://github.com/YOUR_USERNAME/screen-share.git
cd screen-share
git remote add upstream https://github.com/jaovito/screen-share.git
bun install --frozen-lockfile
bun run bootstrap
bun run doctor
bun run infra:up
bun run db:migrate
bun run dev
```

Use Bun 1.4.3, pinned Rust/rustfmt/clippy, and Docker with Compose. See [README](README.md) and [development](docs/development.md) for platform details. Native desktop needs Windows; macOS/Linux browser previews do not validate capture or the Windows shell.

Create a topic branch from current upstream main. Branch names such as feat/language-selector or fix/readiness-timeout are fine. Keep changes focused and preserve unrelated work. Never include .env, generated LiveKit config, credentials, recordings, build output, or personal window/screen data.

## Conventions

- Write documentation, code identifiers, comments, and test descriptions in English. UI text belongs in feature-local pt-BR/es/en catalogs, with English keys.
- Use strict TypeScript, Bun scripts, 2-space indentation, width 100, single quotes, trailing commas, and blank lines between logical blocks. Use bun run format / bun run lint.
- Keep frontend responsibilities in app/features/shared according to [frontend conventions](docs/frontend.md). Use public feature/workspace exports and extensionless local imports. Aliases do not waive architecture checks.
- Keep domain rules pure, application dependent on ports, and runtime/SDK/database behavior in adapters. Do not pass frames/PCM through JSON, HTTP control, or React state.
- Do not rewrite applied migrations. Generate/review SQL, journal, and snapshot and test schema changes with disposable PostgreSQL.
- Never present planned profiles as detected capabilities, synthetic values as real metrics, or healthy control HTTP as proof of media/E2EE. Preserve explicit source selection and unavailable-media behavior.
- Update docs for changed operation/contracts. Record durable architecture changes in a short ADR; avoid unrelated refactors or speculative abstractions.

[AGENTS.md](AGENTS.md) and [agent workflows](docs/agents.md) also guide coding assistants. You remain responsible for generated code and reported evidence.

## Validation

Choose checks that match the change and report what actually ran:

```sh
bun run check:ts
bun run check:rust
bun run test:coverage
```

For runtime/build changes, also run bun run test:binary and bun run test:e2e. Install Chromium first with bun run test:e2e:install. For persistence/restart changes, run bun run test:persistence. For a layout change, inspect desktop/mobile screenshots. Docker/Chromium/platform prerequisites must not be hidden by skipped tests.

Coverage requires **80% lines and 80% functions per executable file**, plus a complete source inventory. Do not lower thresholds, hide code in exclusions, or add tests without behavioral assertions. Documentation-only changes need link/example/schema checks rather than unrelated product tests. See [testing policy](docs/testing.md).

## Opening a pull request

Push your topic branch to your fork and open a PR against main. Use a descriptive English title; conventional prefixes such as feat:, fix:, docs:, or refactor: are welcome. Fill the [PR template](.github/PULL_REQUEST_TEMPLATE.md) with motivation, behavior, checks, and limitations. Include reproduction steps/screenshots when relevant, but sanitize sensitive data. Small cohesive commits are preferred; do not force-push shared branches unexpectedly.

The CI workflow checks TypeScript/integration/coverage/standalone API/E2E, portable Rust, Windows desktop, and the container smoke. Fork workflows have read-only tokens and may require a maintainer to approve workflow execution. That is separate from code review.

All changes to main require a PR, successful required checks, and resolved review threads. Other contributors need @jaovito's approval of the latest head commit. A newer commit invalidates the approval for the policy check. PRs authored by @jaovito may merge without a review, while still requiring CI and a PR. This exemption does not waive review on someone else's PR merely because the maintainer clicks Merge. See [governance](docs/github.md).

Discuss review feedback constructively and keep this project welcoming. No signing, deployment, access to production, or internal credentials are needed to contribute. Development installers are unsigned and are not production releases.

## License

By submitting a contribution, you agree that your contribution is provided under the project's [MIT license](LICENSE). Keep third-party license notices and disclose any introduced assets/dependencies.
