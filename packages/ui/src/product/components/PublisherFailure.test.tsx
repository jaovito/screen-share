import { afterEach, expect, it, jest, mock } from 'bun:test';
import { LocaleProvider, localeStorageKey } from '@screen-share/i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductServer, sessionId, sharingStatus, snapshot } from '../fixtures.test';
import { productTranslations } from '../locales';
import { createProductApi } from '../services/product-api';
import type { PublisherAdapter } from '../types';
import { PublisherPanel } from './PublisherPanel';

afterEach(() => jest.useRealTimers());

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

it('retains a safe native startup failure across status polling and clears it after an explicit successful retry', async () => {
  localStorage.setItem(localeStorageKey, 'en');
  const room = activeRoom();
  const start = mock(async () => sharingStatus('sharing'));
  start.mockRejectedValueOnce('authorization_invalid');
  const status = mock(async () => sharingStatus());
  const publisher: PublisherAdapter = {
    managesAuthorization: true,
    start,
    renew: mock(async () => sharingStatus()),
    stop: mock(async () => sharingStatus('stopped')),
    pause: mock(async () => sharingStatus('paused')),
    resume: mock(async () => sharingStatus('sharing')),
    status,
  };
  jest.useFakeTimers();
  const view = render(
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <PublisherPanel
        api={createProductApi('https://control.example.test', new ProductServer().control)}
        snapshot={room}
        mediaKey={'a'.repeat(43)}
        publisher={publisher}
      />
    </LocaleProvider>,
  );
  const button = screen.getByRole('button', { name: 'Choose window and start' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.submit(button.closest('form') ?? document.body);
  await screen.findByText(/start: authorization_invalid/);
  expect(publisher.stop).toHaveBeenCalled();
  const polls = status.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(1100);
    for (let index = 0; index < 8; index++) await Promise.resolve();
  });
  expect(status.mock.calls.length).toBeGreaterThan(polls);
  expect(screen.getByText(/start: authorization_invalid/)).toBeDefined();
  jest.useRealTimers();
  fireEvent.submit(button.closest('form') ?? document.body);
  await screen.findByText('Publishing selected source');
  expect(screen.queryByText(/start: authorization_invalid/)).toBeNull();
  view.unmount();
});

it('identifies control authorization rejection before native startup and still releases the publisher', async () => {
  localStorage.setItem(localeStorageKey, 'pt-BR');
  const server = new ProductServer();
  const publisher: PublisherAdapter = {
    managesAuthorization: true,
    start: mock(async () => sharingStatus('sharing')),
    renew: mock(async () => sharingStatus()),
    stop: mock(async () => sharingStatus('stopped')),
    pause: mock(async () => sharingStatus('paused')),
    resume: mock(async () => sharingStatus('sharing')),
    status: mock(async () => sharingStatus()),
  };
  const view = render(
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <PublisherPanel
        api={createProductApi('https://control.example.test', (request) =>
          request.path.endsWith('/grants')
            ? Promise.resolve({ status: 409, body: { error: 'session_unavailable' } })
            : server.control(request),
        )}
        snapshot={activeRoom()}
        mediaKey={'a'.repeat(43)}
        publisher={publisher}
      />
    </LocaleProvider>,
  );
  const button = screen.getByRole('button', { name: 'Escolher janela e iniciar' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.submit(button.closest('form') ?? document.body);
  await screen.findByText(/Código da falha: start: control_http_409/);
  expect(publisher.start).not.toHaveBeenCalled();
  expect(publisher.stop).toHaveBeenCalled();
  view.unmount();
});

it('shows closed native worker failures and signed HRESULTs even when status IPC succeeds', async () => {
  localStorage.setItem(localeStorageKey, 'pt-BR');
  const { PublisherDiagnostics } = await import('./PublisherDiagnostics');
  const current = {
    ...sharingStatus('failed'),
    reason: 'encoder_failed',
    failure: {
      stage: 'encoder_initialization' as const,
      code: 'native_call_failed' as const,
      operation: 'mf_output_type' as const,
      hresult: -1072875852,
    },
  };
  const view = render(
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <PublisherDiagnostics status={current} />
    </LocaleProvider>,
  );
  expect(screen.getByRole('alert').textContent).toContain(
    'encoder_initialization / native_call_failed / mf_output_type / 0xc00d36b4',
  );
  view.rerender(
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <PublisherDiagnostics
        status={{ ...current, failure: { ...current.failure, operation: null, hresult: null } }}
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole('alert').textContent).toContain(
    'encoder_initialization / native_call_failed',
  );
  expect(screen.getByRole('alert').textContent).not.toContain('0x');
  view.unmount();
});
