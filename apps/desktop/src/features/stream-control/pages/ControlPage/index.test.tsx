import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';

const invoke = mock();
const isTauri = mock(() => true);
mock.module('@tauri-apps/api/core', () => ({ invoke, isTauri }));
const { App } = await import('../../../../app/App');

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
