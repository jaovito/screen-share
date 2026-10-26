FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/control-api/package.json apps/control-api/package.json
COPY apps/viewer-web/package.json apps/viewer-web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
RUN bun install --frozen-lockfile
COPY packages/contracts packages/contracts
COPY apps/control-api apps/control-api
RUN bun run --filter @screen-share/contracts build && bun run --filter @screen-share/control-api build

FROM oven/bun:1.4.3 AS dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/control-api/package.json apps/control-api/package.json
COPY apps/viewer-web/package.json apps/viewer-web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
RUN bun install --production --frozen-lockfile --filter @screen-share/control-api --filter @screen-share/contracts --ignore-scripts

# A API publicada permanece em Node LTS; Bun é usado nas ferramentas e no build.
FROM node:24.22.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=node:node /app/apps/control-api/dist apps/control-api/dist
COPY --from=build --chown=node:node /app/apps/control-api/drizzle apps/control-api/drizzle
USER node
EXPOSE 3000
CMD ["node", "apps/control-api/dist/index.js"]
