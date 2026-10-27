import { beforeEach, expect, it, mock, spyOn } from 'bun:test';
import type { ProductMediaGrant, RoomSnapshot } from '@screen-share/contracts';
import { localeStorageKey } from '@screen-share/i18n';
import type { ReceiverAdapter } from '@screen-share/ui/product';
import { fireEvent, render, screen } from '@testing-library/react';

const ownerId = '11111111-1111-4111-8111-111111111111';
const viewerId = '22222222-2222-4222-8222-222222222222';
const roomId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
let native = false;
let controlResponse: (path: string) => unknown;
const invoke = mock(async (command: string, args: { request: { path: string } }) => {
  if (command !== 'control_request') throw new Error('Unexpected native media command');
  return { status: 200, body: controlResponse(args.request.path) };
});
const stop = mock(() => {});
const receive = mock((input: Parameters<ReceiverAdapter>[0]) => {
  input.onState('subscribed');
  return { stop };
});
mock.module('@tauri-apps/api/core', () => ({ isTauri: () => native, invoke }));
mock.module('@screen-share/rtc-browser', () => ({ receiveEncryptedSession: receive }));
const { App } = await import('../../../../app/App');

beforeEach(() => {
  invoke.mockClear();
  receive.mockClear();
  stop.mockClear();
  localStorage.setItem(localeStorageKey, 'en');
  window.history.replaceState({}, '', '/');
});

for (const mode of ['browser preview', 'native application'] as const) {
  it(`watches through the shared receiver in ${mode} and stops on unmount`, async () => {
    native = mode === 'native application';
    const snapshot: RoomSnapshot = {
      room: {
        id: roomId,
        name: 'Friday games',
        ownerId,
        epoch: 1,
        membershipRevision: 1,
        membership: 'approved',
        state: 'active',
        createdAt: '2026-10-27T00:00:00.000Z',
      },
      members: [
        { userId: ownerId, name: 'Owner', status: 'approved', role: 'owner' },
        { userId: viewerId, name: 'Viewer', status: 'approved', role: 'viewer' },
      ],
      session: {
        id: sessionId,
        epoch: 1,
        membershipRevision: 1,
        publisherId: ownerId,
        state: 'active',
        createdAt: '2026-10-27T00:00:00.000Z',
      },
      cleanupPending: false,
    };
    const grant: ProductMediaGrant = {
      version: 1,
      sessionId,
      epoch: 1,
      rtcRoom: `ss-${roomId}`,
      participantId: viewerId,
      publisherId: ownerId,
      role: 'viewer',
      serverUrl: 'ws://127.0.0.1:7880',
      accessToken: 'synthetic-test-token-not-usable',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    };
    controlResponse = (path) => {
      if (path.endsWith('/get-session'))
        return { user: { id: viewerId, name: 'Viewer', email: 'viewer@example.test' } };
      if (path.endsWith('/grants')) return { grant };
      if (path === '/v1/rooms') return { rooms: [snapshot.room] };
      return snapshot;
    };
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          if (native) throw new Error('Native credentials must stay in the control transport');
          return Response.json(controlResponse(new URL(String(input)).pathname));
        },
        { preconnect: mock() },
      ),
    );
    const view = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Friday games/ }));
    const key = await screen.findByLabelText('Content key');
    expect(receive).not.toHaveBeenCalled();
    fireEvent.change(key, { target: { value: 'a'.repeat(43) } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(key.closest('form') ?? document.body);
    await screen.findByText('Encrypted track subscribed; verify visible playback');
    expect(receive).toHaveBeenCalledTimes(1);
    const input = receive.mock.calls[0]?.[0];
    expect(input?.grant).toEqual(grant);
    expect(input?.mediaKey).toBe('a'.repeat(43));
    expect(input?.video).toBeInstanceOf(HTMLVideoElement);
    expect(input?.audio).toBeInstanceOf(HTMLAudioElement);
    if (native) {
      expect(fetch).not.toHaveBeenCalled();
      expect(invoke.mock.calls.some(([, args]) => args.request.path.endsWith('/grants'))).toBe(
        true,
      );
    } else {
      expect(invoke).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalled();
    }
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
}
