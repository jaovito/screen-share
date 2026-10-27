import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { ReadinessPort } from '../application/readiness';

export const migrationsFolder = join(
  import.meta.dir,
  Bun.isStandaloneExecutable ? 'drizzle' : '../../../../drizzle',
);

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 1500,
    idleTimeoutMillis: 10000,
    query_timeout: 2000,
    statement_timeout: 1500,
  });
  // This event must not expose DSN, query, parameters, or driver errors.
  pool.on('error', () => console.error(JSON.stringify({ event: 'database_connection_error' })));

  const db = drizzle(pool);
  const expected = readMigrationFiles({ migrationsFolder }).map((m) => m.hash);
  const readiness: ReadinessPort = {
    async check() {
      const rows = await pool.query<{ hash: string }>(
        'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id',
      );

      if (
        expected.length === 0 ||
        expected.some((hash, i) => rows.rows[i]?.hash !== hash) ||
        rows.rowCount !== expected.length
      )
        throw new Error('Pending or divergent migrations');

      await pool.query('SELECT id, owner_id, state, created_at, updated_at FROM rooms LIMIT 0');
      await pool.query(`SELECT id,name,owner_id,epoch,membership_revision,state FROM private_rooms LIMIT 0;
        SELECT id,name,email FROM auth_user LIMIT 0;
        SELECT id,token,expires_at,user_id FROM auth_session LIMIT 0;
        SELECT room_id,user_id,status,role FROM room_members LIMIT 0;
        SELECT id,room_id,rtc_room,epoch,state FROM media_sessions LIMIT 0;
        SELECT id,room_id,session_id,completed_at,available_at FROM rtc_cleanup_outbox LIMIT 0`);
    },
  };

  return {
    pool,
    db,
    readiness,
    async migrate() {
      await migrate(db, { migrationsFolder });
    },
    close: () => pool.end(),
  };
}

export async function retryDatabase(check: () => Promise<void>, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      await check();

      return;
    } catch {
      if (attempt >= attempts) throw new Error('Database unavailable after bounded retries');

      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
}
