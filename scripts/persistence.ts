import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { root, run } from './lib';

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

  throw new Error('Disposable database did not start');
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
      '--cpus',
      '1',
      '--memory',
      '256m',
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

  if (!port || !/^\d+$/.test(port)) throw new Error('Disposable database port unavailable');

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
  await sql(
    "INSERT INTO auth_user(id,name,email) VALUES ('00000000-0000-4000-8000-000000000001','Synthetic durability owner','durability@example.test'); INSERT INTO private_rooms(id,name,owner_id) VALUES('00000000-0000-4000-8000-000000000002','Synthetic durability room','00000000-0000-4000-8000-000000000001'); INSERT INTO room_members(room_id,user_id,status,role) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','approved','owner');",
  );
  const journal = z
    .object({ entries: z.array(z.object({ tag: z.string() })) })
    .parse(await Bun.file(resolve(root, 'apps/control-api/drizzle/meta/_journal.json')).json());
  await run('docker', ['restart', name], quiet);
  await wait();
  await sql(
    `DO $$ BEGIN IF (SELECT owner_id FROM rooms WHERE id='00000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'persistence-owner' OR (SELECT count(*) FROM drizzle.__drizzle_migrations) <> ${journal.entries.length} OR (SELECT count(*) FROM room_members WHERE room_id='00000000-0000-4000-8000-000000000002' AND role='owner') <> 1 THEN RAISE EXCEPTION 'persistence failed'; END IF; END $$;`,
  );
  console.log('Persistence confirmed after restarting disposable PostgreSQL.');
} finally {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  spawnSync('docker', ['volume', 'rm', volume], { stdio: 'ignore' });
}
