import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import { localeStorageKey } from '@screen-share/i18n';
import { render, screen } from '@testing-library/react';

mock.module('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: mock() }));
const { App } = await import('../../../../app/App');

afterEach(() => {
  Reflect.deleteProperty(window.location, 'search');
});

it('opens product authentication in desktop browser preview without invoking native publication', async () => {
  window.history.replaceState({}, '', '/');
  localStorage.setItem(localeStorageKey, 'en');
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(null));
  render(<App />);
  await screen.findByLabelText('Password');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('A screen. Your people.');
});

it('preserves explicitly requested legacy desktop diagnostics', async () => {
  Object.defineProperty(window.location, 'search', {
    configurable: true,
    value: '?mode=experiment',
  });
  localStorage.setItem(localeStorageKey, 'en');
  localStorage.setItem(localeStorageKey, 'en');
  expect(window.location.search).toBe('?mode=experiment');
  render(<App />);
  await screen.findByRole('status');
  expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('A screen. Your people.');
});
