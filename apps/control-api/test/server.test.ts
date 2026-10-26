import { afterEach, beforeEach, expect, it, jest, mock, spyOn } from 'bun:test';
import type { Config } from '../src/config.js';

const state = {
  closeDatabase: mock(),
  query: mock(),
  retry: mock(),
  listeners: new Map<string, () => void>(),
  closeCallback: undefined as (() => void) | undefined,
  closeAll: mock(),
  closeIdle: mock(),
};

mock.module('../src/modules/system/adapters/postgres.js', () => ({
  createDatabase: () => ({
    pool: { query: state.query },
    readiness: { check: mock() },
    close: state.closeDatabase,
  }),
  retryDatabase: (check: () => Promise<void>) => state.retry(check),
}));

mock.module('@hono/node-server', () => ({
  serve: (_options: unknown, listening: () => void) => {
    listening();

    return {
      on: (event: string, callback: () => void) => state.listeners.set(event, callback),
      close: (callback: () => void) => {
        state.closeCallback = callback;
      },
      closeAllConnections: state.closeAll,
      closeIdleConnections: state.closeIdle,
    };
  },
}));

const { startServer } = await import('../src/runtime/server.js');

const config: Config = {
  DATABASE_URL: 'postgres://example',
  HOST: '127.0.0.1',
  PORT: 3000,
  CORS_ORIGINS: [],
  LIVEKIT_URL: 'http://example',
  LIVEKIT_API_KEY: 'unused-key',
  LIVEKIT_API_SECRET: 'unused-secret',
};

beforeEach(() => {
  jest.useFakeTimers();
  spyOn(process, 'on').mockReturnValue(process);
  spyOn(console, 'log').mockImplementation(() => {});
  state.closeDatabase.mockResolvedValue(undefined);
  state.query.mockResolvedValue(undefined);
  state.retry.mockImplementation((check: () => Promise<void>) => check());
});

afterEach(() => {
  jest.useRealTimers();
  mock.restore();
  mock.clearAllMocks();
});

it('drains requests, closes the pool once and exits successfully', async () => {
  const terminate = mock();
  const app = startServer(config, terminate);

  await Promise.resolve();
  app.shutdown();
  app.shutdown();
  state.closeCallback?.();
  await Promise.resolve();
  expect(state.closeDatabase).toHaveBeenCalledTimes(1);
  expect(state.closeIdle).toHaveBeenCalledTimes(1);
  expect(terminate).toHaveBeenCalledWith(0);
});

it('forces shutdown at the deadline and handles server/database failures', async () => {
  const terminate = mock();

  state.retry.mockRejectedValue(new Error('offline'));

  const app = startServer(config, terminate);

  await Promise.resolve();
  await Promise.resolve();
  app.shutdown();
  jest.advanceTimersByTime(8000);
  await Promise.resolve();
  expect(state.closeAll).toHaveBeenCalledTimes(1);
  expect(terminate).toHaveBeenCalledWith(1);
  state.listeners.get('error')?.();
  await Promise.resolve();
  expect(state.closeDatabase).toHaveBeenCalled();
});
