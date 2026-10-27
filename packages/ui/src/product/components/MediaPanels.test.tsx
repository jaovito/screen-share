import { afterEach, beforeEach, expect, it, jest, mock } from 'bun:test';
import { LocaleProvider, localeStorageKey } from '@screen-share/i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { ProductServer, sessionId, sharingStatus, snapshot, viewerId } from '../fixtures.test';
import { productTranslations } from '../locales';
import { createProductApi } from '../services/product-api';
import type { NativeSharingStatus, PublisherAdapter, ReceiverAdapter } from '../types';
import { PublisherPanel } from './PublisherPanel';
import { ReceiverPanel } from './ReceiverPanel';
import { SecretValue } from './SecretValue';

function Messages({ children }: PropsWithChildren) {
  return (
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      {children}
    </LocaleProvider>
  );
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

beforeEach(() => {
  localStorage.setItem(localeStorageKey, 'en');
});
afterEach(() => {
  jest.useRealTimers();
});

it('starts explicit native capture, pauses/resumes, changes profile and renews authorization without replaying the key', async () => {
  const server = new ProductServer();
  const api = createProductApi('https://control.example.test', server.control);
  let current: NativeSharingStatus = sharingStatus();
  const publisher: PublisherAdapter = {
    start: mock(async () => {
      current = sharingStatus('sharing');
      return current;
    }),
    renew: mock(async () => current),
    stop: mock(async () => {
      current = sharingStatus('stopped');
      return current;
    }),
    pause: mock(async () => {
      current = sharingStatus('paused');
      return current;
    }),
    resume: mock(async () => {
      current = sharingStatus('sharing');
      return current;
    }),
    status: mock(async () => current),
  };
  const view = render(
    <Messages>
      <PublisherPanel
        api={api}
        snapshot={activeRoom()}
        mediaKey={'a'.repeat(43)}
        publisher={publisher}
      />
    </Messages>,
  );
  fireEvent.change(screen.getByLabelText('Video profile'), { target: { value: '720p30' } });
  fireEvent.change(screen.getByLabelText('Maximum bitrate (Mbps)'), { target: { value: '3' } });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Choose window and start' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Choose window and start' }).closest('form') ??
      document.body,
  );
  await screen.findByText('Publishing selected source');
  expect(screen.getByLabelText('Quality priority').hasAttribute('disabled')).toBe(true);
  expect(publisher.start).toHaveBeenCalledWith(
    expect.objectContaining({
      profileId: '720p30',
      bitrateBps: 3_000_000,
      mediaKey: 'a'.repeat(43),
      qualityMode: 'motion',
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Pause' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await screen.findByText('Paused');
  fireEvent.click(screen.getByRole('button', { name: 'Resume same source' }));
  await screen.findByText('Publishing selected source');
  fireEvent.change(screen.getByLabelText('Video profile'), { target: { value: '480p30' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Apply profile to the same source' }).closest('form') ??
      document.body,
  );
  await waitFor(() =>
    expect(publisher.renew).toHaveBeenCalledWith(expect.any(Object), '480p30', 3_000_000),
  );
  jest.useFakeTimers();
  await act(async () => {
    jest.advanceTimersByTime(20_000);
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
  expect(publisher.stop).toHaveBeenCalled();
  view.unmount();
});

it('stops native media on a failed command and on component cleanup', async () => {
  const api = createProductApi('https://control.example.test', new ProductServer().control);
  const stop = mock(async () => sharingStatus('stopped'));
  const publisher: PublisherAdapter = {
    start: mock(async () => {
      throw new Error('Synthetic engine failure');
    }),
    renew: mock(async () => sharingStatus()),
    stop,
    pause: mock(async () => sharingStatus('paused')),
    resume: mock(async () => sharingStatus('sharing')),
    status: mock(async () => sharingStatus()),
  };
  const view = render(
    <Messages>
      <PublisherPanel
        api={api}
        snapshot={activeRoom()}
        mediaKey={'a'.repeat(43)}
        publisher={publisher}
      />
    </Messages>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Choose window and start' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Choose window and start' }).closest('form') ??
      document.body,
  );
  await screen.findByText('Stopped after a media or authorization failure');
  expect(stop).toHaveBeenCalled();
  view.unmount();
  expect(stop.mock.calls.length).toBeGreaterThan(1);
});

it('receives only a bound grant, clears inputs, reports actual receiver samples, renews and releases every player', async () => {
  const server = new ProductServer();
  const api = createProductApi('https://control.example.test', server.control);
  const stop = mock(() => {});
  let receiveInput: Parameters<ReceiverAdapter>[0] | undefined;
  const receive: ReceiverAdapter = mock(async (input) => {
    receiveInput = input;
    input.onState('subscribed');
    input.onMetrics?.({
      intervalMs: 1000,
      decodedFps: 29,
      inboundBitrateBps: 1_000_000,
      droppedFrames: 1,
      averageDecodeMs: 2,
      packetLossRatio: 0.01,
      jitterMs: 3,
      transportRttMs: 20,
      width: 854,
      height: 480,
    });
    return { stop };
  });
  const view = render(
    <Messages>
      <ReceiverPanel api={api} snapshot={activeRoom()} userId={viewerId} receiver={receive} />
    </Messages>,
  );
  const key = screen.getByLabelText('Content key');
  fireEvent.change(key, { target: { value: 'a'.repeat(43) } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Watch encrypted stream' }));
  await screen.findByText('Encrypted track subscribed; verify visible playback');
  expect((key as HTMLInputElement).value).toBe('');
  expect(receive).toHaveBeenCalledTimes(1);
  expect(receiveInput?.grant.role).toBe('viewer');
  expect(screen.getByText('Transport RTT')).toBeDefined();
  jest.useFakeTimers();
  await act(async () => {
    jest.advanceTimersByTime(20_000);
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
  // The old player must be stopped before any replacement can own the element.
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  expect(stop).toHaveBeenCalled();
  expect(screen.getByText('Idle')).toBeDefined();
  view.unmount();
});

it('rejects invalid keys and failed receiver construction and explains unavailable clipboard access', async () => {
  const api = createProductApi('https://control.example.test', new ProductServer().control);
  const receive: ReceiverAdapter = mock(async () => {
    throw new Error('Synthetic unsupported client');
  });
  const view = render(
    <Messages>
      <ReceiverPanel api={api} snapshot={activeRoom()} userId={viewerId} receiver={receive} />
    </Messages>,
  );
  fireEvent.change(screen.getByLabelText('Content key'), { target: { value: 'short' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByLabelText('Content key').closest('form') ?? document.body);
  expect(screen.getByText('The content key format is invalid')).toBeDefined();
  fireEvent.change(screen.getByLabelText('Content key'), { target: { value: 'a'.repeat(43) } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByLabelText('Content key').closest('form') ?? document.body);
  await screen.findByText('Stopped after a media or authorization failure');
  view.unmount();
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  try {
    render(
      <Messages>
        <SecretValue value={'a'.repeat(43)} label="Synthetic secret" />
      </Messages>,
    );
    fireEvent.focus(screen.getByLabelText('Synthetic secret'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy privately' }));
    expect(screen.getByText('Copy unavailable. Select and copy the value manually.')).toBeDefined();
  } finally {
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('fails closed when native status cannot be read instead of presenting an idle healthy engine', async () => {
  const api = createProductApi('https://control.example.test', new ProductServer().control);
  const stop = mock(async () => sharingStatus('stopped'));
  const publisher: PublisherAdapter = {
    start: mock(async () => sharingStatus('sharing')),
    renew: mock(async () => sharingStatus('sharing')),
    stop,
    pause: mock(async () => sharingStatus('paused')),
    resume: mock(async () => sharingStatus('sharing')),
    status: mock(async () => {
      throw new Error('Synthetic IPC failure');
    }),
  };
  const view = render(
    <Messages>
      <PublisherPanel
        api={api}
        snapshot={activeRoom()}
        mediaKey={'a'.repeat(43)}
        publisher={publisher}
      />
    </Messages>,
  );
  await screen.findByText('Stopped after a media or authorization failure');
  expect(stop).toHaveBeenCalled();
  view.unmount();
});

it('requests system audio only after explicit opt-in and leaves it disabled when unsupported', async () => {
  const server = new ProductServer();
  const api = createProductApi('https://control.example.test', server.control);
  const capable = { ...sharingStatus(), audioSupported: true };
  const publisher: PublisherAdapter = {
    start: mock(async () => ({ ...capable, state: 'sharing' as const })),
    renew: mock(async () => capable),
    stop: mock(async () => capable),
    pause: mock(async () => capable),
    resume: mock(async () => capable),
    status: mock(async () => capable),
  };
  const view = render(
    <Messages>
      <PublisherPanel
        api={api}
        snapshot={activeRoom()}
        mediaKey={'a'.repeat(43)}
        publisher={publisher}
      />
    </Messages>,
  );
  const audio = screen.getByRole('combobox', { name: 'Audio source' });
  expect((audio as HTMLSelectElement).value).toBe('off');
  await waitFor(() => expect(audio.hasAttribute('disabled')).toBe(false));
  fireEvent.change(audio, { target: { value: 'system' } });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Choose window and start' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Choose window and start' }).closest('form') ??
      document.body,
  );
  await screen.findByText('Publishing selected source');
  expect(publisher.start).toHaveBeenCalledWith(expect.objectContaining({ audioMode: 'system' }));
  expect(server.calls.find((call) => call.path.endsWith('/grants'))?.body).toHaveProperty(
    'includeAudio',
    true,
  );
  expect(audio.hasAttribute('disabled')).toBe(true);
  view.unmount();
});

it('passes explicit text priority and displays actual adaptation targets without inventing measurements', async () => {
  const api = createProductApi('https://control.example.test', new ProductServer().control);
  let current = sharingStatus();
  const publisher: PublisherAdapter = {
    start: mock(async () => {
      current = {
        ...sharingStatus('sharing'),
        profileId: '720p30',
        adaptationReason: 'network_pressure',
        targetBitrateBps: 3_000_000,
        qualityChanges: 1,
      };
      return current;
    }),
    status: async () => current,
    stop: async () => sharingStatus('stopped'),
    pause: async () => sharingStatus('paused'),
    resume: async () => sharingStatus('sharing'),
    renew: async () => current,
  };
  const view = render(
    <Messages>
      <PublisherPanel
        api={api}
        snapshot={activeRoom()}
        mediaKey={'a'.repeat(43)}
        publisher={publisher}
      />
    </Messages>,
  );
  fireEvent.change(screen.getByLabelText('Quality priority'), { target: { value: 'text' } });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Choose window and start' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Choose window and start' }).closest('form') ??
      document.body,
  );
  await screen.findByText(
    'Last adjustment: reduced quality. Current target 720p30, 3000000 bps. Applied changes: 1.',
  );
  expect(publisher.start).toHaveBeenCalledWith(expect.objectContaining({ qualityMode: 'text' }));
  view.unmount();
});

it('leaves native authorization renewal independent of renderer timers', async () => {
  const api = createProductApi('https://control.example.test', new ProductServer().control);
  const renew = mock(async () => sharingStatus('sharing'));
  const publisher: PublisherAdapter = {
    managesAuthorization: true,
    start: async () => sharingStatus('sharing'),
    status: async () => sharingStatus('sharing'),
    stop: async () => sharingStatus('stopped'),
    pause: async () => sharingStatus('paused'),
    resume: async () => sharingStatus('sharing'),
    renew,
  };
  const view = render(
    <Messages>
      <PublisherPanel
        api={api}
        snapshot={activeRoom()}
        mediaKey={'a'.repeat(43)}
        publisher={publisher}
      />
    </Messages>,
  );
  await screen.findByText('Publishing selected source');
  jest.useFakeTimers();
  await act(async () => {
    jest.advanceTimersByTime(60_000);
    for (let index = 0; index < 12; index++) await Promise.resolve();
  });
  expect(renew).not.toHaveBeenCalled();
  view.unmount();
});
