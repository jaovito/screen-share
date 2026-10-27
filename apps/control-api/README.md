# Control API

Bun/Hono control-plane API with PostgreSQL/Drizzle. It currently implements liveness, migration-aware readiness, and the eight-profile catalog. It does not issue room tokens or provide authentication, invitations, capture, or media transport.

## Run from source

From repository root, complete [local setup](../../README.md#run-locally), then:

```sh
bun run --filter @screen-share/control-api start
```

For watch mode, use bun run dev (API/viewer) or bun run --filter @screen-share/control-api dev. Bun executes TypeScript directly; contracts are consumed from source, so no build is needed. Default API address is http://127.0.0.1:3000.

Configuration comes from the root bootstrap/environment: DATABASE_URL, HOST, PORT, CORS_ORIGINS, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET. Never print credential values. See [.env.example](../../.env.example).

## Database

```sh
bun run db:migrate
bun run test:integration
```

Readiness returns 503 for unavailable database or missing/divergent migration history. It never applies migrations through HTTP. After schema changes, run bun run --filter @screen-share/control-api db:generate and review SQL/journal/snapshot. Never rewrite applied history or use db push. See [development](../../docs/development.md#migrations).

## Optional executable

```sh
bun run --filter @screen-share/control-api build
```

Output is dist/control-api (dist/control-api.exe on Windows), for the build host's platform. It embeds the Bun runtime, dependencies, and migration SQL/meta. Run it with serve (default), migrate, smoke, or ready, supplying validated runtime environment variables. Automatic dotenv/bunfig loading is disabled in the executable. Rebuild after adding migrations.

From root, bun run stack:up builds/runs the Linux image, applies migrations, and checks readiness. Host/container API modes both use port 3000; stop the previous mode first. Normal shutdown preserves volumes.

## Validate and navigate

Use bun run check:ts, bun run test:coverage, bun run test:binary, and bun run test:e2e from root. The standalone check copies only the executable into an empty directory and uses a disposable database.

src/index.ts is minimal command composition; src/runtime owns CLI/HTTP orchestration; src/modules owns domain/application/adapters. Use extensionless imports with `@modules/*` and `@runtime/*` aliases, retaining pure domain boundaries. See [architecture](../../docs/architecture.md) and [contributing](../../CONTRIBUTING.md).
