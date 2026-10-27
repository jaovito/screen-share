# Self-hosted deployment

This is an operator-run, single-node deployment for the private product. It is separate from `infra/compose.yaml`: the development stack keeps its loopback bindings and volumes. No deployment, DNS changes, certificate issuance, firewall changes or public connectivity tests have been executed by preparing these files. Code/configuration validation does not establish hardware, two-PC, restrictive-network or capacity acceptance; consult [PLAN.md](../PLAN.md) and [validation.md](validation.md).

## Topology and prerequisites

Use a maintained Linux server with Docker Engine/Compose, OpenSSL and an up-to-date public CA trust store, an approved immutable Git revision, reliable backups, and **two distinct public IPv4 addresses assigned to its interfaces**. This baseline deliberately uses one public address for HTTPS and another for RTC/TURN. A basic HTTP reverse proxy cannot route TURN/TLS by HTTP hostname. Direct embedded TURN/TLS needs TCP 443; assigning it a second address avoids competing with web HTTPS. The [LiveKit deployment](https://docs.livekit.io/transport/self-hosting/deployment/) and [firewall reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/) describe those requirements.

Choose three DNS names you control:

| Name | Example role                                 | DNS address |
| ---- | -------------------------------------------- | ----------- |
| Site | Private viewer **and** authenticated API     | Web IPv4    |
| RTC  | LiveKit signaling over WSS                   | Web IPv4    |
| TURN | Embedded authenticated TURN/TLS and TURN/UDP | RTC IPv4    |

Viewer and API intentionally share the same HTTPS origin. This avoids cross-site browser-cookie assumptions and keeps native clients pinned to one compiled API origin. Caddy routes `/api/auth/*`, `/v1/*`, `/healthz` and `/readyz` to the private API, serves the static viewer, and proxies the RTC hostname to private LiveKit signaling. Caddy supports [WebSocket proxying](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and obtains site/RTC certificates through [automatic HTTPS](https://caddyserver.com/docs/automatic-https).

The operator must provision a **publicly trusted, hostname-matching full certificate chain and unencrypted PEM private key for TURN** before starting. The preparation script bounds the files, refuses self-issued/CA leaves, checks the SAN hostname with the standard X509 API, verifies the server chain/purpose/validity with the installed OpenSSL trust store, and compares the certificate/private-key public keys. It does not invent a certificate verifier or perform online revocation checks. Verify public browser/SDK trust with the issuing CA's tools; a privately modified operator trust store does not establish public trust. An explicit `SSL_CERT_FILE` overrides the operator trust bundle for verification; never use a synthetic/private fixture CA for production. No generated development CA is a production substitute. Provision renewal and atomically replace the two private TURN files, then restart only LiveKit during an announced session interruption.

The production image pins Caddy **2.11.7** by its multi-platform digest. PostgreSQL **17.11**, LiveKit **1.13.11** and Bun **1.4.3** match the repository pins. The SFU uses the documented single UDP mux port; the broad UDP range is not enabled. Docker bridge networking is a functional baseline requiring actual NAT/ICE tests; the LiveKit guide recommends host networking for optimal performance. Do not infer a throughput benchmark from this configuration.

## Prepare exclusive private configuration

From the reviewed clone, install dependencies with `bun install --frozen-lockfile`. On Linux/macOS, replace every value below with your actual domain/address/certificate paths. The example placeholders are deliberately rejected by the script.

```bash
bun --no-env-file scripts/prepare-production.ts \
  --site-host share.your-domain.tld \
  --rtc-host rtc.your-domain.tld \
  --turn-host turn.your-domain.tld \
  --web-ip YOUR_ASSIGNED_PUBLIC_WEB_IPV4 \
  --rtc-ip YOUR_ASSIGNED_PUBLIC_RTC_IPV4 \
  --acme-email operations@your-domain.tld \
  --turn-cert /secure/path/turn-fullchain.pem \
  --turn-key /secure/path/turn-private-key.pem \
  --validate-only
```

After validating operator inputs, repeat without `--validate-only`. The command exclusively creates `infra/production/.generated/` with mode 0700 and files with mode 0600. It generates independent database, authentication and SFU secrets, copies the explicitly supplied TURN materials, and writes effective LiveKit configuration. It refuses an existing output directory and never overwrites a running installation. Protect the operator account and backups; Docker administrators are trusted and can inspect server-side environment variables. Media content keys are generated only by clients and are absent from this configuration and database.

Generated paths are Git-ignored and excluded from Docker build contexts. Do not print `docker compose config` with resolved output; use `config --quiet`. Do not publish production `.env` files, certificates/private keys, resolved YAML, tokens or invitation values.

## Build and start explicitly

Set the required DNS records and firewall rules yourself before starting Caddy. ACME HTTP validation needs the web address on TCP 80/443. Do not point an HTTP-only CDN/proxy at the RTC/TURN address and assume it carries UDP.

| Public address | Open inbound ports | Purpose                               |
| -------------- | ------------------ | ------------------------------------- |
| Web IPv4       | TCP 80, TCP 443    | ACME, HTTPS viewer/API, WSS signaling |
| RTC IPv4       | TCP 443            | Authenticated embedded TURN/TLS       |
| RTC IPv4       | UDP 3478           | Embedded TURN/UDP/STUN                |
| RTC IPv4       | TCP 7881, UDP 7882 | Direct ICE/TCP and UDP mux            |

**Never publish PostgreSQL 5432, API 3000, LiveKit 7880, Caddy's admin API or its private 9080 health endpoint.** The Compose file exposes none of those to the host. The database uses an internal Docker network. Review host/provider firewall behavior, including Docker's forwarding rules, rather than relying solely on a host frontend firewall.

The following starts only the separately named production project. Each upgrade runs a fresh migration process and stops if migration fails. API readiness checks the actual embedded migration history. Do not reuse a completed migrator container as upgrade evidence.

```bash
set -e
COMPOSE_FILE=infra/production/compose.yaml
ENV_FILE=infra/production/.generated/production.env
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres livekit
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrate
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps control-api web
```

The frontend build accepts only `PUBLIC_API_URL` as public configuration; server passwords/signing credentials are not build arguments. Its value is the validated site HTTPS origin. The API remains the unprivileged standalone Bun executable; Caddy's image runs as UID 10001. Volume ownership is initialized from the image. LiveKit retains its upstream image's process permissions to read the private certificate mounts.

## Validate before inviting friends

Check site TLS trust, real `/readyz`, account creation/login/logout and room authorization. Verify an unapproved account cannot receive a grant. Exercise invitation expiry/revocation and owner approval with assessment-owned accounts. Confirm WSS, direct UDP, TCP fallback and forced TURN/TLS on separate networks using actual ICE diagnostics; no one connectivity path proves the others. Follow the [hardware/two-PC runbook](m1-hardware-runbook.md) using the deployed endpoints, client-generated independent keys, real decoded playback and wrong-key rejection.

Membership removal closes the old RTC session before activating its successor. Clients stop on stale membership/epoch or failed authorization refresh. Verify modified clients retaining old credentials cannot receive current-session media. Never bypass the cleanup gate to make a demo continue. Manual key distribution remains through an independently authenticated encrypted channel; do not deliver a new key under the old shared key.

Resource limits are protective defaults, not proven capacity: PostgreSQL 1 CPU/512 MiB, API 1 CPU/512 MiB, web 1 CPU/256 MiB and SFU 2 CPU/1 GiB. Measure egress, UDP loss, CPU and memory against actual 2–8 participant traffic and all intended profiles. There is no Redis/high availability/multi-region or automatic autoscaling in this single-node topology.

## Operation, retention and recovery

Back up the database and migration history through a private encrypted operator workflow. Back up authentication/SFU configuration separately with restricted access. Store the updater signing key outside the deployment host. Client media keys are intentionally not recoverable from the service. Do not enable recording, screenshots, transcripts, request-body logging or raw RTC traces as incident shortcuts.

Caddy access/proxy-error log namespaces are excluded because signaling query strings can contain bearer credentials. Application authentication/authorization audits remain sanitized structured API events. Never enable broad HTTP debug logging on a real session. Export only voluntary sanitized metrics, without raw network dumps, user source titles, invitation values or key material.

Normal `docker compose ... stop`/`down` preserves named volumes. Never append `--volumes` as routine maintenance. Apply forward migrations before restarting the API; an older executable may reject a newer schema. Restore a reviewed database/configuration backup into a separate authorized recovery environment before any production replacement. Database/password/SFU rotation and certificate renewal are explicit maintenance operations, not rerunning the exclusive setup script.

For a server with only one public IPv4, design a separate TURN host or reviewed layer-4 TLS routing/load-balancer topology using the official guide. Do not remap direct TURN/TLS to an arbitrary advertised port or expose the local development Compose stack as a workaround.
