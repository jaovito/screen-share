# Monorepo and versions

Status: accepted for M0 · 2026-10-26.

## Context

UI, API, and shell must evolve with compatible contracts.

## Decision

pnpm workspaces and one Cargo workspace; exact direct versions, Node LTS 24.22.1, pnpm 10.20.0, and Rust 1.99.1. No additional monorepo framework.

## Consequences

Contracts build before consumers. pnpm-lock.yaml/Cargo.lock are tool-generated; updates require revalidation. Later development-tool decisions are recorded in ADRs 0007/0008.

## Verified sources

- [Official Node releases](https://nodejs.org/dist/index.json)
- [Official Rust stable manifest](https://static.rust-lang.org/dist/channel-rust-stable.toml)
- [npm registry](https://registry.npmjs.org/): exact versions checked through each package endpoint.
- [crates.io Tauri](https://crates.io/crates/tauri), [tauri-build](https://crates.io/crates/tauri-build).
- [LiveKit v1.13.11](https://github.com/livekit/livekit/releases/tag/v1.13.11), [release schema](https://github.com/livekit/livekit/blob/v1.13.11/config-sample.yaml).
- [PostgreSQL release notes](https://www.postgresql.org/docs/release/); postgres:17.11-bookworm verified by Docker pull.
- [Hono Node adapter](https://hono.dev/docs/getting-started/nodejs), [Tauri Vite](https://v2.tauri.app/start/frontend/vite/).
- [Compose startup](https://docs.docker.com/compose/how-tos/startup-order/), [port publication](https://docs.docker.com/engine/network/port-publishing/).

OCI tags are concrete versions. Digest pinning may be adopted in image-update workflows; observed digests are in the validation report.
