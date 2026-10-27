import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Browser, chromium, expect, type Page } from '@playwright/test';
import { build, type PreviewServer, preview } from 'vite';
import { assertCsp, assertPlayback } from '../tests/desktop-receiver/assert-playback';
import { fixtureApi } from '../tests/desktop-receiver/fixture-api';
import {
  downloadSfu,
  ownedProcess,
  removeOwnedDirectory,
  waitFor,
} from '../tests/desktop-receiver/resources';
import { ensureWebViewRuntime } from '../tests/desktop-receiver/webview-runtime';
import { finalizeFixture } from '../tooling/desktop-receiver/cleanup';
import { fixtureWindowConfig } from '../tooling/desktop-receiver/config';
import { fixtureRtcAddress } from '../tooling/desktop-receiver/network';
import { root, run } from './lib';
import { freePort } from './ports';

if (process.platform !== 'win32') throw new Error('Actual WebView2 receiver test requires Windows');
const publisherOnly = process.argv[2] === '--publisher-only';
if (process.argv.length > (publisherOnly ? 3 : 2))
  throw new Error('Only --publisher-only is supported by the desktop receiver fixture');

const directory = await mkdtemp(join(tmpdir(), 'ss-desktop-receiver-'));
const ports = await Promise.all(Array.from({ length: 4 }, () => freePort()));
const [signaling, tcp, debug, publisherPort] = ports;
if (!signaling || !tcp || !debug || !publisherPort || new Set(ports).size !== ports.length)
  throw new Error('Distinct fixture ports required');
const apiKey = randomBytes(18).toString('hex');
const apiSecret = randomBytes(32).toString('hex');
const serverUrl = `ws://127.0.0.1:${signaling}`;
const rtcAddress = fixtureRtcAddress(
  networkInterfaces(),
  process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_OS === 'Windows',
);
let fixture: ReturnType<typeof fixtureApi> | undefined;
let sfu: ReturnType<typeof ownedProcess> | undefined;
let application: ReturnType<typeof ownedProcess> | undefined;
let publisherServer: PreviewServer | undefined;
let publisherBrowser: Browser | undefined;
let webview: Browser | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let page: Page | undefined;
let failure: unknown;
let stage = 'download verified SFU';
const evidence = join(root, 'test-results/desktop-receiver');
function progress(next: string) {
  stage = next;
  console.info(`Desktop receiver: ${stage}`);
}

try {
  progress('verify Windows WebView2 runtime prerequisite');
  await ensureWebViewRuntime(directory);
  progress('download verified SFU');
  const executable = await downloadSfu(directory);
  const config = join(directory, 'livekit.yaml');
  await writeFile(
    config,
    [
      `port: ${signaling}`,
      'bind_addresses: ["127.0.0.1"]',
      'rtc:',
      `  tcp_port: ${tcp}`,
      // This local WebView fixture proves encrypted playback over ICE/TCP.
      // UDP and restrictive-network/TURN acceptance remain separate real-network gates.
      '  force_tcp: true',
      `  node_ip: "${rtcAddress}"`,
      '  use_external_ip: false',
      `  enable_loopback_candidate: ${rtcAddress === '127.0.0.1'}`,
      '  ips:',
      `    includes: ["${rtcAddress}/32"]`,
      'keys:',
      `  ${apiKey}: ${apiSecret}`,
      'logging:',
      '  level: error',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  );
  progress('start owned SFU');
  sfu = ownedProcess(executable, ['--config', config]);
  await waitFor(`http://127.0.0.1:${signaling}`, sfu.alive);
  fixture = fixtureApi(serverUrl, apiKey, apiSecret);
  // Rebuild only the standalone parent after the ordinary NSIS artifact exists.
  // These public fixture URLs are never packaged into the previously built installer.
  if (!publisherOnly) {
    progress('compile standalone fixture parent');
    const automation = fixtureWindowConfig(
      JSON.parse(await readFile(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')),
      join(directory, 'app-data'),
      Number(debug),
      rtcAddress === '127.0.0.1',
    );
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
          TAURI_CONFIG: JSON.stringify(automation),
        },
      },
    );
  }
  const publisherRoot = resolve(root, 'tests/desktop-receiver/publisher');
  const outDir = join(directory, 'publisher');
  progress('build synthetic publisher');
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
  // Test-only autoplay; no camera, microphone, screen capture or production flags.
  publisherBrowser = await chromium.launch({
    args: [
      ...(rtcAddress === '127.0.0.1' ? ['--allow-loopback-in-peer-connection'] : []),
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const publisher = await publisherBrowser.newPage();
  await publisher.goto(`http://127.0.0.1:${publisherPort}`);
  progress('publish synthetic encrypted H264 and Opus');
  const key = await publisher.evaluate(
    (grant) => window.desktopPublisher.start(grant),
    await fixture.publisherGrant(),
  );
  if (publisherOnly) {
    await publisher.evaluate(() => window.desktopPublisher.stop());
    console.info(
      'Windows synthetic publisher negotiated encrypted H264 and Opus with the real SFU.',
    );
  } else {
    progress('launch Windows application');
    application = ownedProcess(join(root, 'target/release/screen-share-desktop.exe'), [], {
      ...process.env,
    });
    // Compilation/download are outside this bounded actual media execution window.
    watchdog = setTimeout(() => {
      void application?.stop().catch(() => {});
      void sfu?.stop().catch(() => {});
    }, 240_000);
    progress('connect WebView2 automation');
    await waitFor(`http://127.0.0.1:${debug}/json/version`, application.alive);
    webview = await chromium.connectOverCDP(`http://127.0.0.1:${debug}`);
    page = webview.contexts()[0]?.pages()[0];
    if (!page) throw new Error('Actual application WebView2 page unavailable');
    await page.waitForURL('https://tauri.localhost/**');
    let webviewRequestedApi = false;
    const fixtureOrigin = fixture.apiUrl;
    page.on('request', (request) => {
      if (request.url().startsWith(fixtureOrigin)) webviewRequestedApi = true;
    });
    const language = page.locator('select');
    await language.selectOption('en');
    progress('verify secure context and exact-origin CSP');
    await assertCsp(page, `http://127.0.0.1:${publisherPort}`);
    progress('authenticate through native cookie transport');
    await page.locator('input[name="email"]').fill(fixture.email);
    await page.locator('input[name="password"]').fill(fixture.password);
    await page.locator('.auth-panel button[type="submit"]').click();
    await page.locator('.room-link').filter({ hasText: fixture.roomName }).click();
    await expect(page.locator('.receive-panel')).toBeVisible();
    progress('verify decoded video/audio, wrong key and stop cleanup');
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
  }
} catch (error) {
  failure = new Error(`Desktop receiver failed during: ${stage}`, { cause: error });
} finally {
  clearTimeout(watchdog);
  await finalizeFixture(failure, [
    async () => {
      if (failure === undefined) return;
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, 'stage.json'), JSON.stringify({ stage }));
      await page?.screenshot({ path: join(evidence, 'window.png'), timeout: 5000 }).catch(() => {});
    },
    () => application?.stop(),
    () => webview?.close(),
    () => publisherBrowser?.close(),
    () => publisherServer?.close(),
    () => fixture?.server.stop(true),
    () => sfu?.stop(),
    () => removeOwnedDirectory(directory),
  ]);
}
