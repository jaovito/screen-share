import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';

const invoke = mock();
const isTauri = mock(() => true);
mock.module('@tauri-apps/api/core', () => ({ invoke, isTauri }));
const { ControlPage } = await import('./index');
const { controlTranslations } = await import('../../locales');
const { LocaleProvider } = await import('@screen-share/i18n');

function App() {
  return (
    <LocaleProvider translations={controlTranslations} titleKey="documentTitle">
      <ControlPage />
    </LocaleProvider>
  );
}

beforeEach(() => {
  isTauri.mockReturnValue(true);
  invoke.mockReset();
});

describe('desktop control', () => {
  it.each(['not_implemented', 'unsupported_platform'])(
    'displays native app status %s without enabling capture',
    async (mediaStatus) => {
      invoke.mockResolvedValue({ version: '0.1.0', platform: 'windows', mediaStatus });
      render(<App />);
      expect(screen.getByRole('status').textContent).toContain('Consultando');
      await screen.findByText('0.1.0');
      expect(invoke).toHaveBeenCalledWith('get_app_info');
      expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true);
      expect(
        screen.getByText(
          mediaStatus === 'not_implemented' ? 'Ainda não implementado' : 'Plataforma sem suporte',
        ),
      ).toBeTruthy();
    },
  );

  it('explains browser preview without calling native IPC', async () => {
    isTauri.mockReturnValue(false);
    render(<App />);
    await screen.findByText(/prévia web não possui IPC/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([new Error('secret'), { version: 1 }])(
    'sanitizes rejection and invalid IPC contracts',
    async (failure) => {
      if (failure instanceof Error) invoke.mockRejectedValue(failure);
      else invoke.mockResolvedValue(failure);

      render(<App />);
      await screen.findByText(/Não foi possível consultar/);
      expect(document.body.textContent).not.toContain('secret');
    },
  );
});

it('switches native status and sanitized errors without repeating IPC', async () => {
  invoke.mockResolvedValue({
    version: '0.1.0',
    platform: 'windows',
    mediaStatus: 'not_implemented',
  });
  const view = render(<App />);
  await screen.findByText('0.1.0');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
  await screen.findByText('Not implemented yet');
  expect(screen.getByRole('button', { name: 'Start streaming' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(document.documentElement.lang).toBe('en');
  view.unmount();
  invoke.mockRejectedValue(new Error('private details'));
  render(<App />);
  await screen.findByText(/Unable to query the native shell/);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'es' } });
  await screen.findByText(/No se pudo consultar el cliente nativo/);
  expect(document.body.textContent).not.toContain('private details');
  expect(document.title).toBe('Screen Share — Escritorio');
});
