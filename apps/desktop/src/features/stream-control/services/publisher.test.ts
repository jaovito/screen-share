import { expect, it, mock } from 'bun:test';
import { nativeSharingStatusSchema } from '@screen-share/contracts';

let available = false;
const invoke = mock(
  async (_name: string, _args?: Record<string, unknown>): Promise<unknown> => ({
    state: 'idle',
    profileId: null,
    elapsedMs: 0,
    framesCaptured: 0,
    framesEncoded: 0,
    encodedBytes: 0,
    queueReplacements: 0,
    captureFps: null,
    encodedFps: null,
    targetFps: null,
    audioSupported: false,
    reason: null,
    encryption: 'pending',
  }),
);
mock.module('@tauri-apps/api/core', () => ({ isTauri: () => available, invoke }));
const { desktopPublisher, desktopControl } = await import('./publisher');

it('exposes publishing only in Tauri and validates every native status response', async () => {
  expect(desktopPublisher()).toBeUndefined();
  expect(desktopControl()).toBeUndefined();
  available = true;
  const publisher = desktopPublisher();
  expect(publisher).toBeDefined();
  expect(publisher?.managesAuthorization).toBe(true);
  if (!publisher) throw new Error('Expected native publisher');
  const grant = {
    version: 1 as const,
    sessionId: '44444444-4444-4444-8444-444444444444',
    epoch: 1,
    rtcRoom: 'ss-33333333-3333-4333-8333-333333333333',
    participantId: '11111111-1111-4111-8111-111111111111',
    publisherId: '11111111-1111-4111-8111-111111111111',
    role: 'publisher' as const,
    serverUrl: 'ws://127.0.0.1:7880',
    accessToken: 'synthetic-test-token-not-usable',
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
  await publisher.start({
    roomId: '33333333-3333-4333-8333-333333333333',
    grant,
    profileId: '1080p60',
    bitrateBps: 10_000_000,
    mediaKey: 'a'.repeat(43),
  });
  expect(invoke.mock.calls.at(-1)?.[1]).toHaveProperty(
    'roomId',
    '33333333-3333-4333-8333-333333333333',
  );
  expect(invoke.mock.calls.at(-1)?.[1]).toHaveProperty('request');
  expect(invoke.mock.calls.at(-1)?.[1]?.request).not.toHaveProperty('roomId');
  await publisher.renew(grant);
  expect(invoke.mock.calls.at(-1)).toEqual(['renew_sharing', { grant }]);
  await publisher.renew(grant, '720p30', 3_000_000);
  expect(invoke.mock.calls.at(-1)?.[1]).toHaveProperty('profileId', '720p30');
  for (const action of [publisher.pause, publisher.resume, publisher.stop, publisher.status]) {
    expect(nativeSharingStatusSchema.safeParse(await action()).success).toBe(true);
  }
  invoke.mockResolvedValueOnce({
    state: 'ready',
    sources: [
      { processId: 42, label: 'Synthetic local application', creationTime: '134058525230000000' },
    ],
  });
  expect((await publisher.audioSources?.())?.sources[0]?.processId).toBe(42);
  expect(invoke.mock.calls.at(-1)).toEqual(['list_audio_sources']);
  invoke.mockResolvedValueOnce({
    state: 'ready',
    sources: [{ processId: 0, label: 'invalid', creationTime: '0' }],
  });
  await expect(publisher.audioSources?.()).rejects.toThrow();
  invoke.mockResolvedValueOnce({ state: 'invented' });
  await expect(publisher.status()).rejects.toThrow();
});

it('uses the native cookie boundary without exposing cookies and rejects aborted or invalid responses', async () => {
  available = true;
  const control = desktopControl();
  if (!control) throw new Error('Expected native control transport');
  invoke.mockResolvedValueOnce({ status: 200, body: { user: null } });
  const signal = new AbortController().signal;
  expect(await control({ path: '/api/auth/get-session', method: 'GET', signal })).toEqual({
    status: 200,
    body: { user: null },
  });
  expect(invoke.mock.calls.at(-1)).toEqual([
    'control_request',
    { request: { path: '/api/auth/get-session', method: 'GET' } },
  ]);
  invoke.mockResolvedValueOnce({ status: 200, body: {} });
  await control({ path: '/api/auth/sign-out', method: 'POST', body: {}, signal });
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    control({ path: '/api/auth/get-session', method: 'GET', signal: aborted.signal }),
  ).rejects.toThrow('aborted');
  invoke.mockResolvedValueOnce({ status: 999, body: {} });
  await expect(control({ path: '/api/auth/get-session', method: 'GET', signal })).rejects.toThrow();
});
