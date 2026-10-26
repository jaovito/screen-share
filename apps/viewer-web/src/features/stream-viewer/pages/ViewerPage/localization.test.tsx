import { expect, it, mock, spyOn } from 'bun:test';
import { localeStorageKey } from '@screen-share/i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../../../app/App';

function unavailableApi() {
  spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
}

it('switches viewer copy, metadata, and persisted preference without another HTTP request', async () => {
  unavailableApi();
  const view = render(<App />);
  await screen.findByText('API ou banco indisponível');
  expect(document.documentElement.lang).toBe('pt-BR');
  fireEvent.change(screen.getByRole('combobox', { name: 'Idioma' }), { target: { value: 'en' } });
  await screen.findByRole('heading', { name: 'Your screen. Your friends.' });
  expect(screen.getByRole('status').textContent).toBe('API or database unavailable');
  expect(document.documentElement.lang).toBe('en');
  expect(document.title).toBe('Screen Share — Viewer');
  expect(localStorage.getItem(localeStorageKey)).toBe('en');
  fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'es' } });
  await screen.findByRole('heading', { name: 'Tu pantalla. Tus amigos.' });
  expect(screen.getByRole('status').textContent).toBe('API o base de datos no disponible');
  expect(document.documentElement.lang).toBe('es');
  expect(document.title).toBe('Screen Share — Espectador');
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  view.unmount();
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Tu pantalla. Tus amigos.' })).toBeTruthy();
  await screen.findByText('API o base de datos no disponible');
});

it('defaults to Portuguese for unsupported preferences and survives unavailable storage', async () => {
  unavailableApi();
  localStorage.setItem(localeStorageKey, 'fr');
  const view = render(<App />);
  expect(screen.getByRole('heading', { name: 'Sua tela. Seus amigos.' })).toBeTruthy();
  view.unmount();
  spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage disabled');
  });
  spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage disabled');
  });
  render(<App />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
  await screen.findByRole('heading', { name: 'Your screen. Your friends.' });
  expect(document.documentElement.lang).toBe('en');
});

it('translates a pending request and its eventual response without changing the request lifetime', async () => {
  const pending: Array<(response: Response) => void> = [];
  const fetcher = mock(() => new Promise<Response>((resolve) => pending.push(resolve)));
  spyOn(globalThis, 'fetch').mockImplementation(Object.assign(fetcher, { preconnect: mock() }));
  render(<App />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
  expect(screen.getByRole('status').textContent).toBe('Connecting to the API…');
  await act(async () => {
    for (const resolve of pending) resolve(new Response('{}', { status: 503 }));
  });
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toBe('API or database unavailable'),
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
