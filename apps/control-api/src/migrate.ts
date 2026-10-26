import { readConfig } from './config.js';
import { log } from './log.js';
import { migrateDatabase } from './runtime/migrate.js';

async function main() {
  await migrateDatabase(readConfig());
}

main().catch(() => {
  log('migration_failed');
  process.exitCode = 1;
});
