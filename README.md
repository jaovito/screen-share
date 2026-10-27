# Screen Share

[![CI](https://github.com/jaovito/screen-share/actions/workflows/ci.yml/badge.svg)](https://github.com/jaovito/screen-share/actions/workflows/ci.yml)

An open-source desktop and web application for private screen sharing among friends. The planned publisher is a Windows desktop app, with a browser viewer and a Rust media core.

**Current status: early development (M0).** You can run the control API, database, web viewer, and desktop UI. Capture, streaming, audio, authentication, invitations, RTC playback, and end-to-end encryption are **not implemented yet**. Sharing remains disabled. The profile catalog shows planned options, not measured hardware capabilities. See the [roadmap](PLAN.md).

## Requirements

| Tool                              | Version / purpose                                                    |
| --------------------------------- | -------------------------------------------------------------------- |
| [Bun](https://bun.sh/)            | **1.4.3**, pinned in .bun-version; dependencies, API, scripts, tests |
| [Rust/rustup](https://rustup.rs/) | **1.99.1**, pinned in rust-toolchain.toml; portable core / desktop   |
| Docker with Compose v2            | PostgreSQL, LiveKit, disposable integration tests                    |
| Git                               | Clone and contribute                                                 |

Rust needs rustfmt/clippy; rustup can download the declared toolchain. The API does not require Node. For native desktop development, use **Windows 11 x64**, MSVC C++ Build Tools, Windows SDK, and WebView2. macOS/Linux support the API, browser interfaces, and portable Rust crates. See [Windows setup](docs/development.md#windows-11-x64).

## Run locally

Start Docker, then run these commands from your terminal:

```sh
git clone https://github.com/jaovito/screen-share.git
cd screen-share
bun install --frozen-lockfile
bun run bootstrap
bun run doctor
bun run infra:up
bun run db:migrate
bun run dev
```

Open:

| Service         | Address                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| Web viewer      | [localhost:5173](http://localhost:5173)                                     |
| API liveness    | [127.0.0.1:3000/healthz](http://127.0.0.1:3000/healthz)                     |
| API readiness   | [127.0.0.1:3000/readyz](http://127.0.0.1:3000/readyz)                       |
| Profile catalog | [127.0.0.1:3000/v1/video-profiles](http://127.0.0.1:3000/v1/video-profiles) |

In another terminal, `bun run smoke` checks HTTP, migrations, and authenticated LiveKit control access. It does not start or verify media.

Bootstrap creates `.env` and `infra/livekit/local.yaml` only when absent, generating local secrets and preserving existing configuration. Never commit either file or put secrets in VITE-prefixed variables. Infrastructure publishes only loopback ports; this setup is for local development, not internet/LAN deployment.

Stop the dev process with Ctrl+C. `bun run infra:down` stops PostgreSQL/LiveKit while preserving data. Do not delete volumes to repair a configuration problem.

### Desktop

On Windows, with the same dependencies/configuration installed:

```sh
bun run dev:desktop
```

On macOS/Linux, inspect the browser-only desktop UI instead:

```sh
bun run --filter @screen-share/desktop dev
```

The preview at [127.0.0.1:1420](http://127.0.0.1:1420) has no native IPC or capture engine. See [desktop instructions](apps/desktop/README.md).

### Container API

Stop the host API before switching modes because both use port 3000:

```sh
bun run stack:up
bun run --filter @screen-share/viewer-web dev
bun run smoke
```

The container runs a standalone Bun executable. Each stack:up runs a fresh migrator before API startup. `bun run stack:down` removes containers/network and preserves database volumes. See [API instructions](apps/control-api/README.md).

## Useful commands

| Command                  | Purpose                                            |
| ------------------------ | -------------------------------------------------- |
| bun run dev              | Watch-mode API and viewer                          |
| bun run dev:desktop      | Native Windows desktop                             |
| bun run test             | Unit/DOM tests without Docker                      |
| bun run check:ts         | Lint, types, architecture, tests, builds           |
| bun run check:rust       | Portable Rust fmt/clippy/tests                     |
| bun run check            | TS + portable Rust + database-backed coverage      |
| bun run test:coverage    | Per-file 80% lines/functions gate; requires Docker |
| bun run test:binary      | Standalone API/migrations test; requires Docker    |
| bun run test:e2e:install | Install Chromium                                   |
| bun run test:e2e         | Real API/database, desktop/mobile browser flows    |
| bun run build            | Browser bundles and standalone API executable      |

Tests create and remove their own databases/processes. They do not reset development data. See [test details](docs/testing.md).

## Repository map

| Path                                           | Purpose                                                      |
| ---------------------------------------------- | ------------------------------------------------------------ |
| [apps/control-api](apps/control-api/README.md) | Bun/Hono API, PostgreSQL/Drizzle, migrations                 |
| [apps/viewer-web](apps/viewer-web/README.md)   | React/Vite browser viewer                                    |
| [apps/desktop](apps/desktop/README.md)         | React UI and Rust/Tauri shell                                |
| crates                                         | Pure domain, application, Windows capture and RTC boundaries |
| packages/contracts                             | Shared HTTP/IPC schemas and compatibility fixture            |
| packages/i18n                                  | Shared locale provider/selector                              |
| packages/ui                                    | Tailwind theme/styles                                        |
| infra                                          | Local Compose and LiveKit template                           |
| scripts                                        | Cross-platform TypeScript development tools                  |
| [docs](docs/README.md)                         | Architecture, development, testing, decisions                |

UI supports **Português (Brasil)**, **Español**, and **English**. pt-BR is default; the header selector remembers the choice locally. Documentation, code, comments, and translation keys use English.

## Troubleshooting

- **Wrong Bun version:** activate the version in .bun-version and rerun doctor.
- **Docker unavailable:** start Docker Desktop/OrbStack and check docker info.
- **Readiness returns 503:** start infra and run db:migrate; HTTP never applies schema changes.
- **Port 5173 busy:** set VIEWER_PORT to a free port and update CORS_ORIGINS in .env, then restart API/viewer.
- **Port 3000 busy:** stop the previous host/container API mode before switching.
- **PostgreSQL password mismatch:** changing .env does not update a password in an initialized volume. Coordinate credential changes with the database; do not erase data.
- **LiveKit credentials mismatch:** align the generated local file with an intentional credential rotation; bootstrap preserves existing files.

More details: [development guide](docs/development.md).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md), then open an [issue](https://github.com/jaovito/screen-share/issues) or pull request. Contributions from forks are welcome. Main accepts changes only through PRs and passing checks; external contributions require code-owner approval. See [repository governance](docs/github.md) for the maintainer-author exception.

Report vulnerabilities privately using [SECURITY.md](SECURITY.md), rather than publishing exploit details in an issue. Local code-review automation does not certify the software as secure or production-ready.

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses.
