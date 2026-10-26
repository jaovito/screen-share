import { afterAll, beforeAll, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { rooms } from '../src/modules/rooms/adapters/schema.js';
import { createDatabase } from '../src/modules/system/adapters/postgres.js';
import { migrateDatabase } from '../src/runtime/migrate.js';

// Contrato: banco DESCARTÁVEL e vazio fornecido pelo runner/CI; nunca o .env de desenvolvimento.
if (process.env.INTEGRATION_DATABASE !== 'disposable')
  throw new Error('Exige banco descartável explícito');

const database = createDatabase(readConfig().DATABASE_URL);

beforeAll(async () => {
  await database.pool.query('SELECT 1');
});
afterAll(async () => {
  await database.close();
});
it('nega readiness sem migration, aplica SQL, valida constraints e recupera após reconectar', async () => {
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
  // A migration adicional é detectada como pendente, e não migra por HTTP.
  await database.pool.query('DELETE FROM drizzle.__drizzle_migrations');
  expect((await app.request('/readyz')).status).toBe(503);
});
