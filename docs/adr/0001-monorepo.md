# Monorepo e versões

Status: aceito para M0 · 26/10/2026.

## Contexto

UI, API e shell precisam evoluir com contratos compatíveis.

## Decisão

pnpm workspaces e Cargo workspace único; versões diretas exatas, Node LTS 24.22.1, pnpm 10.20.0 e Rust 1.99.1. Sem framework adicional de monorepo.

## Consequências

Build de contratos precede consumidores. pnpm-lock.yaml e Cargo.lock são gerados pelas ferramentas; atualizações exigem revalidar os checks.

## Fontes verificadas

- [Node: releases oficiais](https://nodejs.org/dist/index.json)
- [Rust stable: manifesto oficial](https://static.rust-lang.org/dist/channel-rust-stable.toml)
- [npm registry](https://registry.npmjs.org/): versões exatas conferidas pelo endpoint de cada pacote.
- [crates.io: Tauri](https://crates.io/crates/tauri), [tauri-build](https://crates.io/crates/tauri-build).
- [LiveKit v1.13.11](https://github.com/livekit/livekit/releases/tag/v1.13.11), [schema da release](https://github.com/livekit/livekit/blob/v1.13.11/config-sample.yaml).
- [PostgreSQL: release notes](https://www.postgresql.org/docs/release/), imagem `postgres:17.11-bookworm` verificada pelo Docker pull.
- [Hono Node adapter](https://hono.dev/docs/getting-started/nodejs), [Tauri Vite](https://v2.tauri.app/start/frontend/vite/).
- [Docker Compose startup](https://docs.docker.com/compose/how-tos/startup-order/), [publicação de portas](https://docs.docker.com/engine/network/port-publishing/).

As tags OCI possuem versões concretas. Lock por digest pode ser adotado no pipeline de atualização de imagens; os digests observados estão no relatório de validação.
