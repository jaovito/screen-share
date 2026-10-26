import type { Config } from '../config.js';
import { log } from '../log.js';
import { createDatabase, retryDatabase } from '../modules/system/adapters/postgres.js';

export async function migrateDatabase(config: Config) {
  const database = createDatabase(config.DATABASE_URL);

  try {
    await retryDatabase(async () => {
      await database.pool.query('SELECT 1');
    });
    // Um único migrador por vez; conexão dedicada mantém o advisory lock.
    const client = await database.pool.connect();

    try {
      await client.query('SELECT pg_advisory_lock(73190421)');
      await database.migrate();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(73190421)');
      } finally {
        client.release();
      }
    }

    await database.readiness.check();
    log('migrations_applied');
  } finally {
    await database.close();
  }
}
