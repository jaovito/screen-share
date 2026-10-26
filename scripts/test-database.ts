import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { run } from './lib.ts';

export async function withTestDatabase(work: (env: NodeJS.ProcessEnv) => Promise<void>) {
  const name = `screen-share-test-${randomBytes(5).toString('hex')}`;
  const password = randomBytes(24).toString('hex');

  try {
    await run(
      'docker',
      [
        'run',
        '--detach',
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

    if (!healthy) throw new Error('PostgreSQL descartável não iniciou');

    const port = spawnSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' })
      .stdout.trim()
      .split(':')
      .at(-1);

    if (!port || !/^\d+$/.test(port)) throw new Error('Porta descartável indisponível');

    await work({
      ...process.env,
      DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
      INTEGRATION_DATABASE: 'disposable',
    });
  } finally {
    spawnSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore' });
  }
}
