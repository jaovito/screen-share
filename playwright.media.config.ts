import { defineConfig, devices } from '@playwright/test';

if (
  process.env.MEDIA_PROOF_DISPOSABLE !== 'true' ||
  !process.env.MEDIA_PROOF_VIEWER_PORT ||
  !process.env.MEDIA_PROOF_PUBLISHER_PORT
)
  throw new Error('Run bun run test:media with its disposable infrastructure.');

export default defineConfig({
  testDir: './tests/media-proof',
  testMatch: process.env.MEDIA_PROOF_NATIVE === 'true' ? 'native.e2e.ts' : 'reception.e2e.ts',
  outputDir: './test-results/media-proof',
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${process.env.MEDIA_PROOF_VIEWER_PORT}`,
    trace: 'off',
    screenshot: 'off',
  },
  webServer: [
    {
      command: `bun run --filter @screen-share/viewer-web preview --port ${process.env.MEDIA_PROOF_VIEWER_PORT} --strictPort`,
      url: `http://127.0.0.1:${process.env.MEDIA_PROOF_VIEWER_PORT}`,
      reuseExistingServer: false,
    },
    {
      command: `bun --bun node_modules/vite/bin/vite.js preview --config tooling/media-proof/publisher.vite.ts --host 127.0.0.1 --port ${process.env.MEDIA_PROOF_PUBLISHER_PORT} --strictPort`,
      url: `http://127.0.0.1:${process.env.MEDIA_PROOF_PUBLISHER_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
