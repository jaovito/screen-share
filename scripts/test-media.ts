import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './lib';
import { freePort } from './ports';

const native = process.argv.includes('--native');
if (process.argv.slice(2).some((arg) => arg !== '--native'))
  throw new Error('Unknown media test argument.');
if (native && !['darwin', 'win32'].includes(process.platform))
  throw new Error('Native SDK proof requires a supported Windows/macOS host.');

const ports = await Promise.all(Array.from({ length: 5 }, () => freePort()));
const [signaling, tcp, udp, viewer, publisher] = ports;
if (!signaling || !tcp || !udp || !viewer || !publisher || new Set(ports).size !== ports.length)
  throw new Error('Distinct disposable test ports are required.');
const directory = await mkdtemp(join(tmpdir(), 'ss-media-test-'));
const name = `ss-media-test-${randomBytes(6).toString('hex')}`;
const apiKey = randomBytes(18).toString('hex');
const apiSecret = randomBytes(32).toString('hex');
const config = join(directory, 'livekit.yaml');

try {
  await writeFile(
    config,
    [
      `port: ${signaling}`,
      'bind_addresses: ["0.0.0.0"]',
      'rtc:',
      `  tcp_port: ${tcp}`,
      `  udp_port: ${udp}`,
      ...(native ? [] : ['  node_ip: "127.0.0.1"']),
      '  use_external_ip: false',
      '  enable_loopback_candidate: true',
      'keys:',
      `  ${apiKey}: ${apiSecret}`,
      'logging:',
      '  level: warn',
    ].join('\n'),
    { mode: 0o600, flag: 'wx' },
  );
  await run(
    'docker',
    [
      'run',
      '--detach',
      '--name',
      name,
      '--cpus',
      '1',
      '--memory',
      '256m',
      '--publish',
      `127.0.0.1:${signaling}:${signaling}`,
      '--publish',
      `127.0.0.1:${tcp}:${tcp}`,
      '--publish',
      `127.0.0.1:${udp}:${udp}/udp`,
      '--mount',
      `type=bind,source=${config},target=/etc/livekit.yaml,readonly`,
      'livekit/livekit-server:v1.13.11',
      '--config',
      '/etc/livekit.yaml',
    ],
    { stdio: 'ignore' },
  );
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${signaling}`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Only this owned test server is probed. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Disposable media server did not start.');
  if (native) {
    const inspection = spawnSync(
      'docker',
      ['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', name],
      { encoding: 'utf8', timeout: 5000 },
    );
    const address = inspection.stdout.trim();
    if (inspection.status !== 0 || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(address))
      throw new Error('Owned media container address unavailable.');
    try {
      const response = await fetch(`http://${address}:${signaling}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error('Private media interface unavailable.');
    } catch {
      throw new Error(
        'Native WebRTC needs a host-routable private container interface (validated with macOS/OrbStack). This Docker runtime does not provide it; no LAN ports were opened.',
      );
    }
  }

  const env = {
    ...process.env,
    MEDIA_PROOF_DISPOSABLE: 'true',
    MEDIA_PROOF_NATIVE: native ? 'true' : 'false',
    MEDIA_PROOF_PUBLISHER_BUILD: join(directory, 'publisher'),
    MEDIA_PROOF_VIEWER_PORT: viewer,
    MEDIA_PROOF_PUBLISHER_PORT: publisher,
    LIVEKIT_PUBLIC_URL: `ws://127.0.0.1:${signaling}`,
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
    VITE_API_URL: 'http://127.0.0.1:1',
  };
  if (native) {
    await run(
      'cargo',
      [
        'rustc',
        '--locked',
        '-p',
        'ss-rtc-livekit',
        '--features',
        'native-proof',
        '--example',
        'preencoded_probe',
        ...(process.platform === 'darwin' ? ['--', '-C', 'link-arg=-ObjC'] : []),
      ],
      {
        env: { ...env, CARGO_BUILD_JOBS: '2', CMAKE_BUILD_PARALLEL_LEVEL: '2' },
      },
    );
  }
  // Serial builds and one browser worker keep this proof bounded on development machines.
  await run('bun', ['run', '--filter', '@screen-share/viewer-web', 'build'], { env });
  await run(
    'bun',
    [
      '--bun',
      'node_modules/vite/bin/vite.js',
      'build',
      '--config',
      'tooling/media-proof/publisher.vite.ts',
    ],
    { env },
  );
  await run(
    'bun',
    [
      '--bun',
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.media.config.ts',
    ],
    { env },
  );
} finally {
  try {
    await run('docker', ['rm', '-f', name], { stdio: 'ignore' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
