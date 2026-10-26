import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { ReadinessPort } from '../application/readiness.js';

export const migrationsFolder = fileURLToPath(new URL('../../../../drizzle', import.meta.url));

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 1500,
    idleTimeoutMillis: 10000,
    query_timeout: 2000,
    statement_timeout: 1500,
  });
  // O evento não deve expor DSN, query, parâmetros ou erro do driver.
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
        throw new Error('Migrations pendentes ou divergentes');

      await pool.query('SELECT id, owner_id, state, created_at, updated_at FROM rooms LIMIT 0');
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
      if (attempt >= attempts) throw new Error('Banco indisponível após tentativas limitadas');

      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
}
