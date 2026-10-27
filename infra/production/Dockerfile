FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/diagnostics/package.json packages/diagnostics/package.json
COPY apps/control-api/package.json apps/control-api/package.json
COPY apps/viewer-web/package.json apps/viewer-web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
RUN bun install --frozen-lockfile
COPY packages packages
COPY apps/viewer-web apps/viewer-web
ARG PUBLIC_API_URL
RUN test -n "$PUBLIC_API_URL"
ENV VITE_API_URL=$PUBLIC_API_URL
RUN bun run --filter @screen-share/viewer-web build

FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f AS runtime
COPY --from=build /app/apps/viewer-web/dist /srv/viewer
COPY infra/production/Caddyfile /etc/caddy/Caddyfile
RUN mkdir -p /data/caddy /config/caddy && chown -R 10001:10001 /data /config /srv/viewer
USER 10001:10001
EXPOSE 80 443
