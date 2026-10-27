import { afterEach, expect, it, jest, mock } from 'bun:test';
import { LocaleProvider, localeStorageKey } from '@screen-share/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ProductServer, sessionId, sharingStatus, snapshot, viewerId } from '../fixtures.test';
import { productTranslations } from '../locales';
import { createProductApi } from '../services/product-api';
import type { PublisherAdapter, ReceiverAdapter } from '../types';
import { PublisherPanel } from './PublisherPanel';
import { ReceiverPanel } from './ReceiverPanel';

async function flush() {
  await act(async () => {
    for (let i = 0; i < 24; i++) await Promise.resolve();
  });
}

function activeRoom() {
  const room = snapshot();
  room.room.state = 'active';
  room.session = {
    id: sessionId,
    epoch: 1,
    membershipRevision: 1,
    publisherId: room.room.ownerId,
    state: 'active',
    createdAt: room.room.createdAt,
  };
  return room;
}

afterEach(() => {
  jest.useRealTimers();
});

it('renews a native publisher only with a fresh server grant and stops on renewal failure', async () => {
  jest.useFakeTimers();
  localStorage.setItem(localeStorageKey, 'en');
  const server = new ProductServer();
  const api = createProductApi('https://control.example.test', server.control);
  const status = sharingStatus('sharing');
  const publisher: PublisherAdapter = {
    start: mock(async () => status),
    renew: mock(async () => status),
    stop: mock(async () => sharingStatus('stopped')),
    pause: mock(async () => sharingStatus('paused')),
    resume: mock(async () => status),
    status: mock(async () => status),
  };
  const view = render(
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <PublisherPanel
        api={api}
        snapshot={activeRoom()}
        publisher={publisher}
        mediaKey={'a'.repeat(43)}
      />
    </LocaleProvider>,
  );
  await flush();
  await act(async () => {
    jest.advanceTimersByTime(20_000);
  });
  await flush();
  expect(publisher.renew).toHaveBeenCalledTimes(1);
  expect(publisher.renew).toHaveBeenCalledWith(
    expect.objectContaining({ role: 'publisher', sessionId }),
  );
  expect(server.calls.filter((call) => call.path.endsWith('/grants'))).toHaveLength(1);
  server.fail = true;
  await act(async () => {
    jest.advanceTimersByTime(20_000);
  });
  await flush();
  expect(publisher.stop).toHaveBeenCalled();
  view.unmount();
});

it('closes an old receiver before installing the renewed player and rejects revoked authorization', async () => {
  jest.useFakeTimers();
  localStorage.setItem(localeStorageKey, 'en');
  const server = new ProductServer();
  const api = createProductApi('https://control.example.test', server.control);
  const stop = mock(() => {});
  const receive: ReceiverAdapter = mock(async (input) => {
    input.onState('subscribed');
    return { stop };
  });
  const view = render(
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <ReceiverPanel api={api} snapshot={activeRoom()} userId={viewerId} receiver={receive} />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText('Content key'), { target: { value: 'a'.repeat(43) } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByLabelText('Content key').closest('form') ?? document.body);
  await flush();
  expect(receive).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(20_000);
  });
  await flush();
  expect(receive).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledTimes(1);
  server.fail = true;
  await act(async () => {
    jest.advanceTimersByTime(20_000);
  });
  await flush();
  expect(screen.getByText('Stopped after a media or authorization failure')).toBeDefined();
  expect(stop).toHaveBeenCalledTimes(2);
  view.unmount();
});
