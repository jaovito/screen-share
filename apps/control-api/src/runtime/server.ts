import { serve } from '@hono/node-server';
import { createApp } from '../app.js';
import type { Config } from '../config.js';
import { log } from '../log.js';
import { createDatabase, retryDatabase } from '../modules/system/adapters/postgres.js';

export function startServer(config: Config, terminate: (code: number) => void = process.exit) {
  const database = createDatabase(config.DATABASE_URL);
  // Liveness stays available during database recovery; readiness checks current state.
  void retryDatabase(async () => {
    await database.pool.query('SELECT 1');
  })
    .then(() => log('database_connected'))
    .catch(() => log('database_unavailable'));

  const server = serve(
    {
      fetch: createApp(database.readiness, config.CORS_ORIGINS).fetch,
      hostname: config.HOST,
      port: config.PORT,
    },
    () => log('listening', { port: config.PORT }),
  );
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;

    stopping = true;
    log('shutdown');

    const deadline = setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections();

      terminate(1);
    }, 8000);

    deadline.unref();
    server.close(() => {
      void database.close().then(() => {
        clearTimeout(deadline);
        terminate(0);
      });
    });

    if ('closeIdleConnections' in server) server.closeIdleConnections();
  };

  server.on('error', () => {
    log('server_failed');
    void database.close().finally(() => terminate(1));
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, shutdown };
}
