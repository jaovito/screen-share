import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type pg from 'pg';
import type { Config } from '../../config';
import { log } from '../../log';
import { createIdentity } from '../identity/adapters/better-auth';
import { productRoutes } from './adapters/http';
import { createRtcControl } from './adapters/livekit';
import { createRoomStore } from './adapters/postgres';
import { createReportCache } from './adapters/report-cache';
import { createRoomReports } from './application/reports';
import { createRoomService } from './application/service';

export function createProductRuntime(pool: pg.Pool, config: Config) {
  const store = createRoomStore(pool);
  const rtc = createRtcControl(
    config.LIVEKIT_URL,
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
  );
  const identity = createIdentity(pool, config, store);
  const reports = createRoomReports(store, createReportCache());
  const service = createRoomService({
    store,
    rtc,
    serverUrl: config.LIVEKIT_PUBLIC_URL,
    now: Date.now,
    id: randomUUID,
    secret: () => randomBytes(32).toString('base64url'),
    hash: (value) => createHash('sha256').update(value).digest('hex'),
  });
  const origins = [...config.CORS_ORIGINS, new URL(config.AUTH_BASE_URL).origin];
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<unknown> | undefined;
  let stopping = false;

  return {
    mount(app: Hono) {
      app.all('/api/auth/*', async (c) => {
        c.header('Cache-Control', 'no-store');
        if (
          ![
            '/api/auth/sign-up/email',
            '/api/auth/sign-in/email',
            '/api/auth/sign-out',
            '/api/auth/get-session',
          ].includes(c.req.path)
        )
          return c.json({ error: 'not_found' }, 404);
        if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
          const origin = c.req.header('origin');
          if (
            !origin ||
            !origins.includes(origin) ||
            c.req.header('sec-fetch-site') === 'cross-site'
          )
            return c.json({ error: 'invalid_origin' }, 403);
        }
        return identity.handler(c.req.raw);
      });
      app.route('/v1', productRoutes(identity, service, store, origins, reports));
    },
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (pending || stopping) return;
        pending = store
          .processCleanup((name) => rtc.remove(name))
          .catch(() => log('rtc_cleanup_deferred'))
          .finally(() => {
            pending = undefined;
          });
      }, 1000);
      timer.unref();
    },
    async stop() {
      stopping = true;
      clearInterval(timer);
      await pending;
    },
  };
}

export type ProductRuntime = ReturnType<typeof createProductRuntime>;
