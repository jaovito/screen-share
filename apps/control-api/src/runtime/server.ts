import { createProductRuntime } from '@modules/private-rooms';
import { createDatabase, retryDatabase } from '@modules/system/adapters/postgres';
import { createApp } from '../app';
import type { Config } from '../config';
import { log } from '../log';

type HttpServer = Pick<Bun.Server<undefined>, 'stop' | 'port'>;
type HttpOptions = {
  hostname: string;
  port: number;
  fetch: (
    request: Request,
    peer?: Pick<Bun.Server<undefined>, 'requestIP'>,
  ) => Response | Promise<Response>;
};

export function startServer(
  config: Config,
  terminate: (code: number) => void = process.exit,
  listen: (options: HttpOptions) => HttpServer = (options) => Bun.serve(options),
) {
  const database = createDatabase(config.DATABASE_URL);
  const product = createProductRuntime(database.pool, config);
  const app = createApp(database.readiness, config.CORS_ORIGINS, product);
  let server: HttpServer;
  try {
    server = listen({
      fetch: (request, peer) => {
        const headers = new Headers(request.headers);
        for (const name of [
          'x-forwarded-for',
          'x-real-ip',
          'cf-connecting-ip',
          'x-internal-client-ip',
        ])
          headers.delete(name);
        headers.set('x-internal-client-ip', peer?.requestIP(request)?.address ?? '127.0.0.1');
        return app.fetch(new Request(request, { headers }));
      },
      hostname: config.HOST,
      port: config.PORT,
    });
  } catch {
    void database.close().catch(() => log('database_close_failed'));
    throw new Error('HTTP server startup failed');
  }
  product.start();
  log('listening', { port: config.PORT });

  // Liveness stays available during database recovery; readiness checks current state.
  void retryDatabase(async () => {
    await database.pool.query('SELECT 1');
  })
    .then(() => log('database_connected'))
    .catch(() => log('database_unavailable'));

  let stopping = false;
  let finished = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log('shutdown');

    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      terminate(code);
    };
    const deadline = setTimeout(() => {
      void server.stop(true).catch(() => log('server_stop_failed'));
      finish(1);
    }, 8000);
    deadline.unref();

    void server
      .stop()
      .then(() => product.stop())
      .then(() => database.close())
      .then(() => finish(0))
      .catch(() => {
        log('shutdown_failed');
        finish(1);
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, shutdown };
}
