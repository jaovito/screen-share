# Control API

Bun/Hono control-plane API with PostgreSQL/Drizzle. It implements liveness, migration-aware readiness, the profile catalog, Better Auth password sessions, private rooms, bounded invitations, owner-approved memberships, session epochs, and narrowly scoped RTC grants. Capture, encoding, and media encryption stay in the clients; the API never receives media keys.

## Run from source

From repository root, complete [local setup](../../README.md#run-locally), then:

```sh
bun run --filter @screen-share/control-api start
```

For watch mode, use bun run dev (API/viewer) or bun run --filter @screen-share/control-api dev. Bun executes TypeScript directly; contracts are consumed from source, so no build is needed. Default API address is http://127.0.0.1:3000.

Configuration comes from the root bootstrap/environment: DATABASE_URL, HOST, PORT, CORS_ORIGINS, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_PUBLIC_URL, AUTH_BASE_URL, and AUTH_SECRET (at least 32 high-entropy characters). HTTPS/WSS are required away from loopback. Use the same canonical hostname in the browser and API so HTTPOnly SameSite=Lax cookies remain same-site. Never print credential values. See [.env.example](../../.env.example).

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


## Private product API

Better Auth 1.7.14 and its official Drizzle adapter own password hashing and database-backed sessions. The public authentication surface is `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/auth/sign-out`, and `/api/auth/get-session`. Signup does not create room membership. Display names are bounded; passwords require 12–128 characters. Email addresses are not verified without a configured delivery provider, so approval uses opaque account identities rather than claiming verified email ownership.

Cookies are HTTPOnly, SameSite=Lax, and Secure on HTTPS. JSON responses expose the user without authentication tokens or session secrets. Exact origins are required for mutations, including the canonical API origin used by the native Rust cookie proxy. CORS is explicit and credentialed. The native HTTP edge replaces untrusted forwarded-address headers with the connecting peer address. Authentication and product limits use atomic persistent PostgreSQL counters; a reverse proxy must receive an explicitly reviewed deployment configuration before client-address attribution is changed.

| Route                                             | Behavior                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| GET/POST `/v1/rooms`                              | List memberships / create an owned room                                     |
| GET `/v1/rooms/:id`                               | Approved-member snapshot; unknown/nonmembers cannot inspect it              |
| GET `/v1/rooms/:id/invites`                       | Owner reads up to 100 recent invitation metadata records without token/hash |
| POST `/v1/rooms/:id/invites`                      | Owner creates a 1–1440 minute, 1–7 use invitation                           |
| POST `/v1/invites/accept`                         | Authenticated user requests pending membership                              |
| DELETE `/v1/rooms/:id/invites/:inviteId`          | Owner revokes invitation                                                    |
| POST `/v1/rooms/:id/members/:userId/approve`      | Owner approves pending membership                                           |
| DELETE `/v1/rooms/:id/members/:userId`            | Owner revokes membership and retires the media session                      |
| POST `/v1/rooms/:id/sessions`                     | Owner prepares a fresh epoch and random RTC room                            |
| POST `/v1/rooms/:id/sessions/:sessionId/activate` | Activate only the current unchanged roster after old RTC cleanup            |
| POST `/v1/rooms/:id/sessions/:sessionId/close`    | Retire the current session                                                  |
| POST `/v1/rooms/:id/grants`                       | Current approved epoch only; owner publishes, others receive                |
| POST `/v1/rooms/:id/reports`                      | Approved current viewers send compact numeric observations                  |
| GET `/v1/rooms/:id/reports`                       | Owner reads current-session client-reported observations                    |

Contracts in `packages/contracts/src/product.ts` define exact JSON inputs/outputs. Errors use `{error: code}` and 400/401/403/404/409/429/503. Requests are capped at 16 KiB. Snapshots are not cached. Pending plus approved membership is capped at eight under a room row lock. Invitation tokens are returned once and only their SHA-256 hashes are stored. Never put an invitation, JWT, password, or media key into a URL or diagnostic log.

RTC JWTs expire after at most 60 seconds. The publisher grant permits screen-share video only by default; the explicit `includeAudio` option additionally permits screen-share audio, without camera/microphone or data publication. Viewers cannot publish. A short token lifetime alone is not strict revocation: membership changes transactionally invalidate grants and session candidates, then a durable outbox deletes the old RTC room. New session activation stays blocked until deletion succeeds. Failed cleanup uses bounded retries and a crash-recoverable claim lease; startup resumes pending work. SDK transport connectivity and two-client media tests remain separate evidence.

Room audit rows contain opaque actor/room identities and action names, without content, tokens, keys, or invite secrets. Authentication state persists in its own auth tables. This implementation does not configure an email provider, public deployment, TLS termination, signing service, or automatic media-key distribution.

Receiver diagnostics are advisory client claims, not authorization or automatic adaptation inputs. Viewers send fresh numeric samples about every three seconds. The API associates identities from authenticated sessions, expires observations after 12 seconds on its monotonic clock, and bounds its process-local cache to seven viewers per room and 1024 entries globally. Reports are never persisted in PostgreSQL; restart or capacity eviction loses them. Multiple API replicas do not share diagnostic observations. Payloads cannot contain track identifiers, addresses, window titles, or media secrets. Owners need sustained observations and actual publisher counters before seeing a qualified possible receiver-limit hint.

Primary references: [Better Auth installation](https://better-auth.com/docs/installation), [Hono integration](https://better-auth.com/docs/integrations/hono), [official Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [atomic rate limits](https://better-auth.com/docs/concepts/rate-limit).
