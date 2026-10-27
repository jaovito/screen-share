import { afterEach, beforeEach, expect, it, jest, mock, spyOn } from 'bun:test';
import type { Config } from '../src/config';

const closeDatabase = mock();
const query = mock();
const retry = mock();
const logs: unknown[] = [];
mock.module('@modules/system/adapters/postgres', () => ({
  createDatabase: () => ({
    pool: { query },
    readiness: { check: mock() },
    close: closeDatabase,
  }),
  retryDatabase: (check: () => Promise<void>) => retry(check),
}));
const { startServer } = await import('@runtime/server');
const config: Config = {
  DATABASE_URL: 'postgres://example',
  HOST: '127.0.0.1',
  PORT: 3000,
  CORS_ORIGINS: [],
  LIVEKIT_URL: 'http://example',
  LIVEKIT_API_KEY: 'unused-key',
  LIVEKIT_API_SECRET: 'unused-secret',
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  spyOn(process, 'on').mockReturnValue(process);
  spyOn(process, 'off').mockReturnValue(process);
  logs.length = 0;
  spyOn(console, 'log').mockImplementation((entry) => {
    logs.push(entry);
  });
  closeDatabase.mockResolvedValue(undefined);
  query.mockResolvedValue(undefined);
  retry.mockImplementation((check: () => Promise<void>) => check());
});

afterEach(() => {
  jest.useRealTimers();
  mock.restore();
  mock.clearAllMocks();
});

it('waits for active requests, closes the pool once, and unregisters shutdown handlers', async () => {
  const terminate = mock();
  let drain: (() => void) | undefined;
  const stop = mock(
    () =>
      new Promise<void>((resolve) => {
        drain = resolve;
      }),
  );
  const app = startServer(config, terminate, () => ({ stop, port: config.PORT }));
  await flush();
  app.shutdown();
  app.shutdown();
  expect(closeDatabase).not.toHaveBeenCalled();
  expect(terminate).not.toHaveBeenCalled();
  drain?.();
  await flush();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(closeDatabase).toHaveBeenCalledTimes(1);
  expect(process.off).toHaveBeenCalledWith('SIGTERM', app.shutdown);
  expect(terminate).toHaveBeenCalledWith(0);
});

it('forces shutdown at the deadline without reporting a later successful exit', async () => {
  const terminate = mock();
  let drain: (() => void) | undefined;
  const stop = mock((force?: boolean) =>
    force
      ? Promise.reject(new Error('force stop failed'))
      : new Promise<void>((resolve) => {
          drain = resolve;
        }),
  );
  retry.mockRejectedValue(new Error('offline'));
  const app = startServer(config, terminate, () => ({ stop, port: config.PORT }));
  await flush();
  app.shutdown();
  jest.advanceTimersByTime(8000);
  await flush();
  expect(stop).toHaveBeenCalledWith(true);
  drain?.();
  await flush();
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(terminate).toHaveBeenCalledWith(1);
});

it('reports database close failures and bind failures without leaking driver details', async () => {
  const terminate = mock();
  closeDatabase.mockRejectedValue(new Error('private driver error'));
  const app = startServer(config, terminate, () => ({ stop: async () => {}, port: config.PORT }));
  app.shutdown();
  await flush();
  expect(terminate).toHaveBeenCalledWith(1);
  expect(() =>
    startServer(config, terminate, () => {
      throw new Error('private bind error');
    }),
  ).toThrow('HTTP server startup failed');
  await flush();
  expect(JSON.stringify(logs)).not.toContain('private');
});

it('serves real HTTP with Bun and drains a native server on shutdown', async () => {
  jest.useRealTimers();
  const terminate = mock();
  const app = startServer({ ...config, PORT: 0 }, terminate);
  try {
    const response = await fetch(`http://127.0.0.1:${app.server.port}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'alive' });
  } finally {
    app.shutdown();
    for (let i = 0; i < 30 && terminate.mock.calls.length === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await app.server.stop(true);
  }
  expect(terminate).toHaveBeenCalledWith(0);
});
