import { afterEach, expect, it, jest, mock, spyOn } from 'bun:test';
import type { PeerReport } from '@screen-share/contracts';
import { LocaleProvider, localeStorageKey } from '@screen-share/i18n';
import { act, render, screen } from '@testing-library/react';
import { sessionId, sharingStatus, snapshot, viewerId } from '../fixtures.test';
import { productTranslations } from '../locales';
import { createProductApi } from '../services/product-api';
import { PeerReportsPanel } from './PeerReportsPanel';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
  });
}
afterEach(() => {
  jest.useRealTimers();
  mock.restore();
});

it('labels private client claims and waits for sustained observations plus actual publisher evidence', async () => {
  jest.useFakeTimers();
  localStorage.setItem(localeStorageKey, 'en');
  let now = 0;
  spyOn(performance, 'now').mockImplementation(() => now);
  const room = snapshot();
  room.room.state = 'active';
  room.members[1] = { userId: viewerId, name: 'Viewer', status: 'approved', role: 'viewer' };
  room.session = {
    id: sessionId,
    epoch: 1,
    membershipRevision: 1,
    publisherId: room.room.ownerId,
    state: 'active',
    createdAt: room.room.createdAt,
  };
  let sequence = 0;
  let fail = false;
  let empty = false;
  const metrics = {
    intervalMs: 1000,
    decodedFps: 10,
    inboundBitrateBps: 1_000_000,
    droppedFrames: 4,
    averageDecodeMs: 80,
    packetLossRatio: 0.1,
    jitterMs: 5,
    transportRttMs: 90,
    width: 1280,
    height: 720,
  };
  const control = mock(async () => ({
    status: fail ? 503 : 200,
    body: {
      sessionId,
      epoch: 1,
      reports: empty
        ? []
        : [
            {
              userId: viewerId,
              reportId: viewerId,
              sequence: ++sequence,
              receivedAt: Date.now(),
              metrics,
            } satisfies PeerReport,
          ],
    },
  }));
  const api = createProductApi('https://control.example.test', control);
  const status = { ...sharingStatus('sharing'), targetFps: 30, encodedFps: 30 };
  const view = render(
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <PeerReportsPanel api={api} snapshot={room} publisherStatus={status} />
    </LocaleProvider>,
  );
  await flush();
  expect(screen.getByText(/CLIENT-REPORTED/)).toBeTruthy();
  expect(screen.getByText('Viewer')).toBeTruthy();
  expect(screen.queryByText(/Several recent/)).toBeNull();
  for (let index = 0; index < 2; index++) {
    now += 3000;
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await flush();
  }
  expect(screen.getByText(/Several recent client observations/)).toBeTruthy();
  empty = true;
  now += 3000;
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  await flush();
  expect(screen.getByText(/No fresh viewer reports/)).toBeTruthy();
  fail = true;
  now += 3000;
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  await flush();
  expect(screen.getByText('Viewer reports are unavailable.')).toBeTruthy();
  await act(async () => {
    window.dispatchEvent(new Event('offline'));
  });
  await flush();
  const count = control.mock.calls.length;
  now += 6000;
  await act(async () => {
    jest.advanceTimersByTime(6000);
  });
  await flush();
  expect(control.mock.calls.length).toBe(count);
  view.unmount();
});

it('does not request reports outside the owner active binding and aborts pending reads on unmount', async () => {
  const room = snapshot();
  const requests: AbortSignal[] = [];
  const control = mock(async (input: { signal: AbortSignal }) => {
    requests.push(input.signal);
    await new Promise(() => {});
    return { status: 200, body: {} };
  });
  const api = createProductApi('https://control.example.test', control);
  const content = () => (
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <PeerReportsPanel api={api} snapshot={room} publisherStatus={null} />
    </LocaleProvider>
  );
  const view = render(content());
  await flush();
  expect(control).not.toHaveBeenCalled();
  room.room.state = 'active';
  room.session = {
    id: sessionId,
    epoch: 1,
    membershipRevision: 1,
    publisherId: room.room.ownerId,
    state: 'active',
    createdAt: room.room.createdAt,
  };
  view.rerender(content());
  await flush();
  expect(requests).toHaveLength(1);
  view.unmount();
  expect(requests[0]?.aborted).toBe(true);
});
