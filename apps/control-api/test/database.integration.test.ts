import { afterAll, beforeAll, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { rooms } from '@modules/rooms/adapters/schema';
import { createDatabase } from '@modules/system/adapters/postgres';
import { migrateDatabase } from '@runtime/migrate';
import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { createApp } from '../src/app';
import { readConfig } from '../src/config';

// Contract: an empty DISPOSABLE database from the runner/CI, never development .env.
if (process.env.INTEGRATION_DATABASE !== 'disposable')
  throw new Error('Exige banco descartável explícito');

const originalConfig = readConfig();
const testName = `legacy_${randomUUID().replaceAll('-', '')}`;
const testUrl = new URL(originalConfig.DATABASE_URL);
testUrl.pathname = `/${testName}`;
const testConfig = { ...originalConfig, DATABASE_URL: testUrl.toString() };
const admin = new pg.Pool({ connectionString: originalConfig.DATABASE_URL, max: 1 });
const database = createDatabase(testConfig.DATABASE_URL);

beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${testName}"`);
  await database.pool.query('SELECT 1');
});
afterAll(async () => {
  await database.close();
  await admin.query(`DROP DATABASE "${testName}" WITH (FORCE)`);
  await admin.end();
});
it('denies readiness without migrations, applies SQL, checks constraints, and recovers after reconnect', async () => {
  const declared = getTableConfig(rooms);

  expect(declared.checks.map((check) => check.name)).toEqual([
    'rooms_state_check',
    'rooms_owner_check',
  ]);

  const app = createApp(database.readiness, []);

  expect((await app.request('/readyz')).status).toBe(503);
  await migrateDatabase(testConfig);
  await database.migrate();
  expect((await app.request('/readyz')).status).toBe(200);
  await expect(
    database.pool.query("INSERT INTO rooms (id, owner_id, state) VALUES ($1, '', 'idle')", [
      randomUUID(),
    ]),
  ).rejects.toThrow();

  const id = randomUUID();

  await database.db.insert(rooms).values({ id, ownerId: 'integration-owner' });

  const reconnected = createDatabase(testConfig.DATABASE_URL);

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
