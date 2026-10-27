FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/diagnostics/package.json packages/diagnostics/package.json
COPY packages/rtc-browser/package.json packages/rtc-browser/package.json
COPY apps/control-api/package.json apps/control-api/package.json
COPY apps/viewer-web/package.json apps/viewer-web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
RUN bun install --frozen-lockfile
COPY scripts scripts
COPY packages/contracts packages/contracts
COPY apps/control-api apps/control-api
RUN bun run --filter @screen-share/control-api build

FROM debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=app:app /app/apps/control-api/dist/control-api /app/control-api
USER app
EXPOSE 3000
CMD ["/app/control-api"]
