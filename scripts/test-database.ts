import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { run } from './lib';

export async function withTestDatabase(work: (env: NodeJS.ProcessEnv) => Promise<void>) {
  const name = `screen-share-test-${randomBytes(5).toString('hex')}`;
  const password = randomBytes(24).toString('hex');

  try {
    await run(
      'docker',
      [
        'run',
        '--detach',
        '--cpus',
        '1',
        '--memory',
        '256m',
        '--name',
        name,
        '--env',
        'POSTGRES_PASSWORD',
        '--publish',
        '127.0.0.1::5432',
        'postgres:17.11-bookworm',
      ],
      { env: { ...process.env, POSTGRES_PASSWORD: password }, stdio: 'ignore' },
    );

    let healthy = false;

    for (let i = 0; i < 40; i++) {
      if (
        spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' })
          .status === 0
      ) {
        healthy = true;

        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!healthy) throw new Error('Disposable PostgreSQL did not start');

    const port = spawnSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' })
      .stdout.trim()
      .split(':')
      .at(-1);

    if (!port || !/^\d+$/.test(port)) throw new Error('Disposable database port unavailable');

    await work({
      ...process.env,
      DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
      INTEGRATION_DATABASE: 'disposable',
      AUTH_SECRET: randomBytes(48).toString('hex'),
      AUTH_BASE_URL: 'http://127.0.0.1:3000',
      LIVEKIT_URL: 'http://127.0.0.1:1',
      LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:1',
      LIVEKIT_API_KEY: `ss_test_${randomBytes(18).toString('hex')}`,
      LIVEKIT_API_SECRET: randomBytes(48).toString('hex'),
    });
  } finally {
    spawnSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore' });
  }
}
