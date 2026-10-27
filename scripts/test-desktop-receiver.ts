import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Browser, chromium, expect } from '@playwright/test';
import { build, type PreviewServer, preview } from 'vite';
import { assertCsp, assertPlayback } from '../tests/desktop-receiver/assert-playback';
import { fixtureApi } from '../tests/desktop-receiver/fixture-api';
import { downloadSfu, ownedProcess, waitFor } from '../tests/desktop-receiver/resources';
import { root, run } from './lib';
import { freePort } from './ports';

if (process.platform !== 'win32') throw new Error('Actual WebView2 receiver test requires Windows');
if (process.argv.length > 2) throw new Error('No desktop receiver test arguments are supported');

const directory = await mkdtemp(join(tmpdir(), 'ss-desktop-receiver-'));
const ports = await Promise.all(Array.from({ length: 5 }, () => freePort()));
const [signaling, tcp, udp, debug, publisherPort] = ports;
if (!signaling || !tcp || !udp || !debug || !publisherPort || new Set(ports).size !== ports.length)
  throw new Error('Distinct fixture ports required');
const apiKey = randomBytes(18).toString('hex');
const apiSecret = randomBytes(32).toString('hex');
const serverUrl = `ws://127.0.0.1:${signaling}`;
let fixture: ReturnType<typeof fixtureApi> | undefined;
let sfu: ReturnType<typeof ownedProcess> | undefined;
let application: ReturnType<typeof ownedProcess> | undefined;
let publisherServer: PreviewServer | undefined;
let publisherBrowser: Browser | undefined;
let webview: Browser | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;

try {
  const executable = await downloadSfu(directory);
  const config = join(directory, 'livekit.yaml');
  await writeFile(
    config,
    [
      `port: ${signaling}`,
      'bind_addresses: ["127.0.0.1"]',
      'rtc:',
      `  tcp_port: ${tcp}`,
      `  udp_port: ${udp}`,
      '  node_ip: "127.0.0.1"',
      '  use_external_ip: false',
      '  enable_loopback_candidate: true',
      'keys:',
      `  ${apiKey}: ${apiSecret}`,
      'logging:',
      '  level: error',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  );
  sfu = ownedProcess(executable, ['--config', config]);
  await waitFor(`http://127.0.0.1:${signaling}`, sfu.alive);
  fixture = fixtureApi(serverUrl, apiKey, apiSecret);
  // Rebuild only the standalone parent after the ordinary NSIS artifact exists.
  // These public fixture URLs are never packaged into the previously built installer.
  await run(
    'cargo',
    [
      'build',
      '--locked',
      '--release',
      '-p',
      'screen-share-desktop',
      '--features',
      'tauri/custom-protocol',
    ],
    {
      env: {
        ...process.env,
        CARGO_BUILD_JOBS: '2',
        SCREEN_SHARE_API_URL: fixture.apiUrl,
        SCREEN_SHARE_RTC_URL: serverUrl,
      },
    },
  );
  const publisherRoot = resolve(root, 'tests/desktop-receiver/publisher');
  const outDir = join(directory, 'publisher');
  await build({
    configFile: false,
    root: publisherRoot,
    logLevel: 'error',
    build: { outDir, emptyOutDir: true },
  });
  publisherServer = await preview({
    configFile: false,
    root: publisherRoot,
    logLevel: 'error',
    build: { outDir },
    preview: { host: '127.0.0.1', port: Number(publisherPort), strictPort: true },
  });
  // Loopback ICE is test-only; no camera, microphone, screen capture or production flags.
  publisherBrowser = await chromium.launch({
    args: ['--allow-loopback-in-peer-connection', '--autoplay-policy=no-user-gesture-required'],
  });
  const publisher = await publisherBrowser.newPage();
  await publisher.goto(`http://127.0.0.1:${publisherPort}`);
  const key = await publisher.evaluate(
    (grant) => window.desktopPublisher.start(grant),
    await fixture.publisherGrant(),
  );
  application = ownedProcess(join(root, 'target/release/screen-share-desktop.exe'), [], {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: join(directory, 'webview-profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debug} --allow-loopback-in-peer-connection --autoplay-policy=no-user-gesture-required`,
  });
  // Compilation/download are outside this bounded actual media execution window.
  watchdog = setTimeout(() => {
    application?.stop();
    sfu?.stop();
  }, 240_000);
  await waitFor(`http://127.0.0.1:${debug}/json/version`, application.alive);
  webview = await chromium.connectOverCDP(`http://127.0.0.1:${debug}`);
  const page = webview.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Actual application WebView2 page unavailable');
  await page.waitForURL('https://tauri.localhost/**');
  let webviewRequestedApi = false;
  const fixtureOrigin = fixture.apiUrl;
  page.on('request', (request) => {
    if (request.url().startsWith(fixtureOrigin)) webviewRequestedApi = true;
  });
  const language = page.locator('select');
  await language.selectOption('en');
  await assertCsp(page, `http://127.0.0.1:${publisherPort}`);
  await page.locator('input[name="email"]').fill(fixture.email);
  await page.locator('input[name="password"]').fill(fixture.password);
  await page.locator('.auth-panel button[type="submit"]').click();
  await page.locator('.room-link').filter({ hasText: fixture.roomName }).click();
  await expect(page.locator('.receive-panel')).toBeVisible();
  await assertPlayback(page, key);
  await publisher.evaluate(() => window.desktopPublisher.stop());
  const observed = fixture.observed();
  expect(observed.authenticatedRequests).toBeGreaterThan(2);
  expect(observed.grants).toBeGreaterThanOrEqual(2);
  expect(webviewRequestedApi).toBe(false);
  console.info(
    'Actual Windows WebView2: native-cookie fixture, secure context, CSP, E2EE H264/video+audio, wrong-key and stop cleanup passed.',
  );
  console.info(
    'Synthetic loopback metadata fixture; real API/SQL, capture hardware, arbitrary-network/TURN and two-PC acceptance are separate gates.',
  );
} finally {
  clearTimeout(watchdog);
  application?.stop();
  await webview?.close().catch(() => {});
  await publisherBrowser?.close();
  await publisherServer?.close();
  fixture?.server.stop(true);
  sfu?.stop();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
