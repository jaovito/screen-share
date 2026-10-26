import { afterAll, beforeAll, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { rooms } from '../src/modules/rooms/adapters/schema.js';
import { createDatabase } from '../src/modules/system/adapters/postgres.js';
import { migrateDatabase } from '../src/runtime/migrate.js';

// Contract: an empty DISPOSABLE database from the runner/CI, never development .env.
if (process.env.INTEGRATION_DATABASE !== 'disposable')
  throw new Error('Exige banco descartável explícito');

const database = createDatabase(readConfig().DATABASE_URL);

beforeAll(async () => {
  await database.pool.query('SELECT 1');
});
afterAll(async () => {
  await database.close();
});
it('denies readiness without migrations, applies SQL, checks constraints, and recovers after reconnect', async () => {
  const declared = getTableConfig(rooms);

  expect(declared.checks.map((check) => check.name)).toEqual([
    'rooms_state_check',
    'rooms_owner_check',
  ]);

  const app = createApp(database.readiness, []);

  expect((await app.request('/readyz')).status).toBe(503);
  await migrateDatabase(readConfig());
  await database.migrate();
  expect((await app.request('/readyz')).status).toBe(200);
  await expect(
    database.pool.query("INSERT INTO rooms (id, owner_id, state) VALUES ($1, '', 'idle')", [
      randomUUID(),
    ]),
  ).rejects.toThrow();

  const id = randomUUID();

  await database.db.insert(rooms).values({ id, ownerId: 'integration-owner' });

  const reconnected = createDatabase(readConfig().DATABASE_URL);

  try {
    await reconnected.readiness.check();
    expect(
      (await reconnected.pool.query('SELECT owner_id FROM rooms WHERE id=$1', [id])).rows[0]
        .owner_id,
    ).toBe('integration-owner');
  } finally {
    await reconnected.close();
  }
  // Missing migration history is detected as pending; HTTP must not migrate it.
  await database.pool.query('DELETE FROM drizzle.__drizzle_migrations');
  expect((await app.request('/readyz')).status).toBe(503);
});
