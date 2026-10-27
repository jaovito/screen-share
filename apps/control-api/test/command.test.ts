import { afterEach, expect, it, mock, spyOn } from 'bun:test';

const config = { PORT: 3000 };
const readConfig = mock(() => config);
const startServer = mock();
const migrateDatabase = mock();
const checkControlPlane = mock();
mock.module('../src/config', () => ({ readConfig }));
mock.module('@runtime/server', () => ({ startServer }));
mock.module('@runtime/migrate', () => ({ migrateDatabase }));
mock.module('@runtime/smoke', () => ({ checkControlPlane }));
const { runCommand } = await import('@runtime/command');

afterEach(() => {
  mock.restore();
  mock.clearAllMocks();
});

it('starts the API by default and dispatches explicit maintenance commands', async () => {
  await runCommand();
  expect(startServer).toHaveBeenCalledWith(config);
  await runCommand('migrate');
  expect(migrateDatabase).toHaveBeenCalledWith(config);
  await runCommand('smoke');
  expect(checkControlPlane).toHaveBeenCalledWith(config);
});

it('rejects unknown commands before reading configuration or starting side effects', async () => {
  await expect(runCommand('reset')).rejects.toThrow('Unknown control API command');
  expect(readConfig).not.toHaveBeenCalled();
  expect(startServer).not.toHaveBeenCalled();
});

it('readiness is a bounded HTTP-only check and propagates failure', async () => {
  const fetcher = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  await runCommand('ready');
  expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/readyz', {
    signal: expect.any(AbortSignal),
  });
  fetcher.mockResolvedValue(new Response('{}', { status: 503 }));
  await expect(runCommand('ready')).rejects.toThrow('API is not ready');
  expect(migrateDatabase).not.toHaveBeenCalled();
});
