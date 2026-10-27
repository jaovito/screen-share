import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import type { ProductMediaGrant, RoomSnapshot } from '@screen-share/contracts';
import { localeStorageKey } from '@screen-share/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../../../app/App';

const ownerId = '11111111-1111-4111-8111-111111111111';
const viewerId = '22222222-2222-4222-8222-222222222222';
const roomId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';

const stop = mock(() => {});
const receive = mock((input: { onState(state: string): void }) => {
  input.onState('subscribed');
  return { stop };
});
mock.module('@screen-share/rtc-browser', () => ({ receiveEncryptedSession: receive }));
afterEach(() => {
  Reflect.deleteProperty(window.location, 'search');
});

it('mounts the authenticated product by default and lazily starts the actual viewer boundary', async () => {
  localStorage.setItem(localeStorageKey, 'en');
  window.history.replaceState({}, '', '/');
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
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/get-session'))
          return Response.json({
            user: { id: viewerId, name: 'Viewer', email: 'viewer@example.test' },
          });
        if (path.endsWith('/grants')) return Response.json({ grant });
        if (path === '/v1/rooms') return Response.json({ rooms: [snapshot.room] });
        return Response.json(snapshot);
      },
      { preconnect: mock() },
    ),
  );
  const view = render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Friday games/ }));
  fireEvent.change(await screen.findByLabelText('Content key'), {
    target: { value: 'a'.repeat(43) },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByLabelText('Content key').closest('form') ?? document.body);
  await screen.findByText('Encrypted track subscribed; verify visible playback');
  expect(receive).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(stop).toHaveBeenCalled();
});

it('keeps the explicit experiment mode separate from the product entry', async () => {
  Object.defineProperty(window.location, 'search', {
    configurable: true,
    value: '?mode=experiment',
  });
  localStorage.setItem(localeStorageKey, 'en');
  spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Synthetic unavailable control API'));
  render(<App />);
  await screen.findByText('API or database unavailable');
  expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('A screen. Your people.');
});
