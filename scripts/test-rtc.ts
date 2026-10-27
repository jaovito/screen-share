import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './lib';
import { freePort } from './ports';

/** A control-plane fixture owns its SFU; product tests never mutate the dev SFU. */
export async function withTestRtc(work: (env: NodeJS.ProcessEnv) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'ss-control-rtc-'));
  const name = `ss-control-rtc-${randomBytes(6).toString('hex')}`;
  const port = await freePort();
  const key = randomBytes(18).toString('hex');
  const secret = randomBytes(48).toString('hex');
  const config = join(directory, 'livekit.yaml');

  try {
    await writeFile(
      config,
      `port: ${port}\nbind_addresses: ["0.0.0.0"]\nrtc:\n  use_external_ip: false\n  node_ip: 127.0.0.1\n  enable_loopback_candidate: true\nkeys:\n  ${key}: ${secret}\nlogging:\n  level: warn\n`,
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
        `127.0.0.1:${port}:${port}`,
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
        const response = await fetch(`http://127.0.0.1:${port}`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Probe only the instance owned by this fixture. */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('The owned RTC control fixture did not start.');
    await work({
      LIVEKIT_URL: `http://127.0.0.1:${port}`,
      LIVEKIT_PUBLIC_URL: `ws://127.0.0.1:${port}`,
      LIVEKIT_API_KEY: key,
      LIVEKIT_API_SECRET: secret,
    });
  } finally {
    spawnSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore', timeout: 10000 });
    await rm(directory, { recursive: true, force: true });
  }
}
