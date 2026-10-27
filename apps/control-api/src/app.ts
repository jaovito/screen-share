import { randomUUID } from 'node:crypto';
import { videoProfiles } from '@modules/profiles';
import { isReady, type ReadinessPort } from '@modules/system/application/readiness';
import { profilesResponseSchema } from '@screen-share/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { log } from './log';

export function createApp(database: ReadinessPort, origins: string[]) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    const started = performance.now();

    c.header('X-Request-ID', requestId);
    await next();
    // Do not log URL/query/body/headers: they may contain future credentials.
    log('request', {
      requestId,
      method: c.req.method,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  });
  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      origin: origins,
      allowMethods: ['GET'],
      allowHeaders: ['Content-Type'],
    }),
  );
  app.get('/healthz', (c) => c.json({ status: 'alive' }));
  app.get('/readyz', async (c) => {
    const ready = await isReady(database);

    return c.json({ status: ready ? 'ready' : 'unavailable' }, ready ? 200 : 503);
  });
  app.get('/v1/video-profiles', (c) =>
    c.json(profilesResponseSchema.parse({ profiles: videoProfiles })),
  );
  app.onError((_error, c) => {
    log('request_failed');

    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
