# Web viewer

React/Vite interface for the future private browser player. M0 shows control connectivity and a static catalog; playback, room membership, authentication, and E2EE are unavailable.

## Run locally

Follow [root setup](../../README.md#run-locally). bun run dev starts API/viewer together. To run this interface separately from repository root:

```sh
bun run --filter @screen-share/viewer-web dev
```

Default address: http://localhost:5173. Root .env sets VIEWER_PORT and the public VITE_API_URL; configure matching CORS_ORIGINS on the API. VITE variables must contain no secrets. The API must be started separately when using the isolated frontend command.

Use the header selector for pt-BR, Spanish, and English. Choices persist locally per origin; translations are bundled and available without an external translation service.

## Build and contribute

```sh
bun run --filter @screen-share/viewer-web build
bun run --filter @screen-share/viewer-web preview
```

Production browser output is dist; preview defaults to 127.0.0.1:5273 and still needs a reachable API with matching CORS configuration.

Composition lives in src/app; viewer behavior/copy belongs to features/stream-viewer. Local aliases are `@features/*`, `@app/*`, `@shared/*`, and workspace contracts/UI are public @screen-share exports. Add all locale values when changing UI text. See [frontend conventions](../../docs/frontend.md) and [contributing](../../CONTRIBUTING.md).

From root, run bun run check:ts, bun run test:coverage, and bun run test:e2e for relevant changes. Layout changes need desktop/mobile visual inspection. Do not claim media capability from a passing control connection.
