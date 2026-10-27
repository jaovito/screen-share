import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { run } from './lib';

const name = `screen-share-persistence-${randomBytes(5).toString('hex')}`;
const volume = `${name}-data`;
const password = randomBytes(24).toString('hex');
const quiet: import('node:child_process').SpawnOptions = {
  stdio: 'ignore',
  env: { ...process.env, POSTGRES_PASSWORD: password },
};

async function wait() {
  for (let i = 0; i < 40; i++) {
    if (
      spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], {
        stdio: 'ignore',
      }).status === 0
    )
      return;

    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Banco descartável não iniciou');
}

const sql = (statement: string) =>
  run(
    'docker',
    ['exec', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { stdio: 'ignore' },
  );

try {
  await run('docker', ['volume', 'create', volume], quiet);
  await run(
    'docker',
    [
      'run',
      '-d',
      '--name',
      name,
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'PGDATA=/var/lib/postgresql/data/pgdata',
      '--publish',
      '127.0.0.1::5432',
      '--mount',
      `type=volume,src=${volume},dst=/var/lib/postgresql/data`,
      'postgres:17.11-bookworm',
    ],
    quiet,
  );
  await wait();

  const port = spawnSync('docker', ['port', name, '5432/tcp'], {
    encoding: 'utf8',
  })
    .stdout.trim()
    .split(':')
    .at(-1);

  if (!port || !/^\d+$/.test(port)) throw new Error('Porta descartável indisponível');

  await run('bun', ['run', '--filter', '@screen-share/contracts', 'typecheck']);
  await run('bun', ['run', '--filter', '@screen-share/control-api', 'migrate'], {
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
    },
  });
  await sql(
    "INSERT INTO rooms (id, owner_id) VALUES ('00000000-0000-4000-8000-000000000001', 'persistence-owner');",
  );
  await run('docker', ['restart', name], quiet);
  await wait();
  await sql(
    "DO $$ BEGIN IF (SELECT owner_id FROM rooms WHERE id='00000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'persistence-owner' OR (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 1 THEN RAISE EXCEPTION 'persistence failed'; END IF; END $$;",
  );
  console.log('Persistência confirmada após reinício de PostgreSQL descartável.');
} finally {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore' });
}
