import { describe, expect, it, jest, mock, spyOn } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../../../app/App';

const profiles = [480, 720, 1080, 1440].flatMap((height) =>
  [30, 60].map((fps) => ({
    id: `${height}p${fps}`,
    height,
    fps,
    width: { 480: 854, 720: 1280, 1080: 1920, 1440: 2560 }[height],
  })),
);

function connectedFetch() {
  return mock(
    async (input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify(String(input).endsWith('/readyz') ? { status: 'ready' } : { profiles }),
      ),
  );
}

describe('viewer control connection', () => {
  it('loads the real contract, displays eight product profiles and retries without cache', async () => {
    const fetcher = connectedFetch();

    spyOn(globalThis, 'fetch').mockImplementation(Object.assign(fetcher, { preconnect: mock() }));
    render(<App />);

    expect(screen.getByRole('status').textContent).toContain('Conectando');
    await screen.findByText('API conectada · banco pronto');
    expect(screen.getAllByText(/FPS/)).toHaveLength(8);
    expect(screen.getAllByText(/QHD/)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Verificar novamente' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('recovers from unavailable HTTP and rejects incompatible and malformed responses', async () => {
    const fetcher = mock().mockResolvedValue(new Response('{}', { status: 503 }));

    spyOn(globalThis, 'fetch').mockImplementation(Object.assign(fetcher, { preconnect: mock() }));
    render(<App />);
    await screen.findByText('API ou banco indisponível');

    fetcher.mockImplementation(async () => new Response('{"profiles":[]}'));
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('Resposta da API incompatível');

    fetcher.mockImplementation(async () => new Response('not json'));
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('Resposta da API incompatível');

    fetcher.mockImplementation(connectedFetch());
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('API conectada · banco pronto');
  });

  it('handles network failure without exposing driver content', async () => {
    spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private error'));
    render(<App />);
    await screen.findByText('API ou banco indisponível');
    expect(document.body.textContent).not.toContain('private error');
  });

  it('does not overwrite a successful retry with an obsolete response', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetcher = mock(
      (_input: string | URL | Request, _init?: RequestInit) =>
        new Promise<Response>((resolve) => pending.push(resolve)),
    );
    spyOn(globalThis, 'fetch').mockImplementation(Object.assign(fetcher, { preconnect: mock() }));
    render(<App />);

    fetcher.mockImplementation(connectedFetch());
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('API conectada · banco pronto');

    await act(async () => {
      for (const resolve of pending) resolve(new Response('{"profiles":[]}'));
      await Promise.resolve();
    });

    expect(screen.getByRole('status').textContent).toBe('API conectada · banco pronto');
  });

  it('times out and aborts requests, including cleanup on unmount', async () => {
    jest.useFakeTimers();

    const signals: AbortSignal[] = [];

    spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        mock((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
          if (init?.signal) signals.push(init.signal);

          return new Promise<Response>(() => {});
        }),
        { preconnect: mock() },
      ),
    );

    try {
      const view = render(<App />);

      await act(async () => {
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
      });
      expect(screen.getByRole('status').textContent).toContain('indisponível');
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});
