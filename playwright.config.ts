import { defineConfig, devices } from '@playwright/test';

const apiPort = process.env.E2E_API_PORT;
const viewerPort = process.env.E2E_VIEWER_PORT;
const desktopPort = process.env.E2E_DESKTOP_PORT;

if (!apiPort || !viewerPort || !desktopPort || process.env.INTEGRATION_DATABASE !== 'disposable') {
  throw new Error('Execute bun run test:e2e para usar banco descartável e portas isoladas.');
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${viewerPort}`,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'bun run --filter @screen-share/control-api start',
      url: `http://127.0.0.1:${apiPort}/readyz`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `bun run --filter @screen-share/viewer-web preview --port ${viewerPort} --strictPort`,
      url: `http://127.0.0.1:${viewerPort}`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `bun run --filter @screen-share/desktop preview --port ${desktopPort} --strictPort`,
      url: `http://127.0.0.1:${desktopPort}`,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
