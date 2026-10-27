import { expect, it, mock } from 'bun:test';

let available = false;
const invoke = mock(
  async (_name: string, _args?: object): Promise<unknown> => ({
    state: 'upToDate',
    version: null,
  }),
);
mock.module('@tauri-apps/api/core', () => ({ isTauri: () => available, invoke }));
const { desktopUpdater } = await import('./updates');

it('uses only fixed updater commands inside Tauri and explicitly confirms installation', async () => {
  expect(desktopUpdater()).toBeUndefined();
  available = true;
  const updater = desktopUpdater();
  if (!updater) throw new Error('Expected native updater');
  for (const state of ['notConfigured', 'upToDate'] as const) {
    invoke.mockResolvedValueOnce({ state, version: null });
    expect(await updater.check()).toEqual({ state, version: null });
  }
  invoke.mockResolvedValueOnce({ state: 'available', version: '1.2.3-rc.1' });
  expect(await updater.check()).toEqual({ state: 'available', version: '1.2.3-rc.1' });
  expect(invoke.mock.calls.at(-1)).toEqual(['check_updates']);
  await updater.install();
  expect(invoke.mock.calls.at(-1)).toEqual(['install_update', { confirmed: true }]);
});

it('rejects malformed metadata instead of exposing remote text as update instructions', async () => {
  available = true;
  const updater = desktopUpdater();
  if (!updater) throw new Error('Expected native updater');
  for (const response of [
    null,
    {},
    'available',
    { state: 'available' },
    { state: 'available', version: '<img src=x>' },
    { state: 'available', version: 'x'.repeat(97) },
    { state: 'available', version: 1 },
    { state: 'other', version: null },
    { state: 'upToDate', version: '1.0.0' },
  ]) {
    invoke.mockResolvedValueOnce(response);
    await expect(updater.check()).rejects.toThrow();
  }
});
