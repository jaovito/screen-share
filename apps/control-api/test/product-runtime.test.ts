import { afterEach, expect, it, jest, mock, spyOn } from 'bun:test';
import { Hono } from 'hono';
import type pg from 'pg';
import { readConfig } from '../src/config';

const processCleanup = mock(async (_remove: (name: string) => Promise<void>) => 0);
const remove = mock(async (_name: string) => {});
const authHandler = mock(async (_request: Request) => Response.json({ user: null }));
mock.module('@modules/private-rooms/adapters/postgres', () => ({
  createRoomStore: () => ({ processCleanup }),
}));
mock.module('@modules/private-rooms/adapters/livekit', () => ({
  createRtcControl: () => ({ remove }),
}));
mock.module('@modules/identity/adapters/better-auth', () => ({
  createIdentity: () => ({ handler: authHandler }),
}));
const { createProductRuntime } = await import('@modules/private-rooms');
const config = readConfig({
  DATABASE_URL: 'postgresql://synthetic@localhost/test',
  CORS_ORIGINS: 'http://127.0.0.1:5173',
  LIVEKIT_URL: 'http://127.0.0.1:7880',
  LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:7880',
  LIVEKIT_API_KEY: 'synthetickey123',
  LIVEKIT_API_SECRET: 'a'.repeat(32),
  AUTH_BASE_URL: 'http://127.0.0.1:3000',
  AUTH_SECRET: 'b'.repeat(32),
});
// The mocked store owns all I/O in these scheduler tests; use a real inert Pool
// object rather than weakening the production constructor type.
const pgModule = await import('pg');
const pool: pg.Pool = new pgModule.default.Pool({ max: 1 });
afterEach(() => {
  jest.useRealTimers();
  mock.restore();
  processCleanup.mockReset();
  processCleanup.mockResolvedValue(0);
});

it('serializes cleanup ticks and waits for the owned pending operation on shutdown', async () => {
  jest.useFakeTimers();
  let resolve: ((value: number) => void) | undefined;
  processCleanup.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const runtime = createProductRuntime(pool, config);
  runtime.start();
  runtime.start();
  jest.advanceTimersByTime(3000);
  expect(processCleanup).toHaveBeenCalledTimes(1);
  let stopped = false;
  const stopping = runtime.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  resolve?.(1);
  await stopping;
  jest.advanceTimersByTime(3000);
  expect(processCleanup).toHaveBeenCalledTimes(1);
  expect(stopped).toBe(true);
});

it('sanitizes a failed cleanup tick without leaving the scheduler stuck', async () => {
  jest.useFakeTimers();
  const logs = spyOn(console, 'log').mockImplementation(() => {});
  processCleanup.mockRejectedValueOnce(new Error('private RTC endpoint'));
  const runtime = createProductRuntime(pool, config);
  runtime.start();
  jest.advanceTimersByTime(1000);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  jest.advanceTimersByTime(1000);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await runtime.stop();
  expect(processCleanup).toHaveBeenCalledTimes(2);
  expect(logs.mock.calls.flat().join(' ')).not.toContain('private RTC endpoint');
});

it('mounts only configured auth capabilities and enforces exact mutation origins', async () => {
  const runtime = createProductRuntime(pool, config);
  const app = new Hono();
  runtime.mount(app);
  expect((await app.request('/api/auth/update-user', { method: 'POST' })).status).toBe(404);
  expect((await app.request('/api/auth/sign-out', { method: 'POST' })).status).toBe(403);
  expect(
    (
      await app.request('/api/auth/sign-out', {
        method: 'POST',
        headers: { origin: config.AUTH_BASE_URL },
      })
    ).status,
  ).toBe(200);
  expect((await app.request('/api/auth/get-session')).status).toBe(200);
  await runtime.stop();
});
