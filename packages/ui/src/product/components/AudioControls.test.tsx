import { beforeEach, expect, it, mock } from 'bun:test';
import type { AudioSourcesResponse } from '@screen-share/contracts';
import { LocaleProvider, localeStorageKey } from '@screen-share/i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ProductServer, sessionId, sharingStatus, snapshot } from '../fixtures.test';
import { productTranslations } from '../locales';
import { createProductApi } from '../services/product-api';
import type { PublisherAdapter } from '../types';
import { AudioControls, type AudioSelection } from './AudioControls';
import { PublisherPanel } from './PublisherPanel';

const source = {
  processId: 42,
  label: 'Synthetic private local title',
  creationTime: '134058525230000000',
};
function publisher(audioSources: () => Promise<AudioSourcesResponse>): PublisherAdapter {
  const capable = { ...sharingStatus(), audioSupported: true };
  return {
    start: mock(async () => ({ ...capable, state: 'sharing' as const })),
    renew: mock(async () => capable),
    stop: mock(async () => capable),
    pause: mock(async () => capable),
    resume: mock(async () => capable),
    status: mock(async () => capable),
    audioSources,
  };
}
function Choices({ adapter }: { adapter: PublisherAdapter }) {
  const [selected, setSelected] = useState<AudioSelection>({ mode: 'off' });
  return (
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <AudioControls
        publisher={adapter}
        supported
        locked={false}
        value={selected}
        onChange={setSelected}
      />
    </LocaleProvider>
  );
}
beforeEach(() => {
  localStorage.setItem(localeStorageKey, 'en');
});

it('enumerates only on explicit application choice and never infers an application from video or auto-selects a result', async () => {
  const server = new ProductServer();
  const api = createProductApi('https://control.example.test', server.control);
  const list = mock(
    async (): Promise<AudioSourcesResponse> => ({ state: 'ready', sources: [source] }),
  );
  const adapter = publisher(list);
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
  const view = render(
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <PublisherPanel api={api} snapshot={room} mediaKey={'a'.repeat(43)} publisher={adapter} />
    </LocaleProvider>,
  );
  const mode = screen.getByRole('combobox', { name: 'Audio source' });
  await waitFor(() => expect(mode.hasAttribute('disabled')).toBe(false));
  expect(list).not.toHaveBeenCalled();
  fireEvent.change(mode, { target: { value: 'process' } });
  const applications = await screen.findByRole('combobox', { name: 'Application for audio' });
  await screen.findByRole('option', { name: /Synthetic private local title/ });
  expect((applications as HTMLSelectElement).value).toBe('');
  expect(
    screen.getByRole('button', { name: 'Choose window and start' }).hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.change(applications, { target: { value: '42' } });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Choose window and start' }).closest('form') ??
      document.body,
  );
  await screen.findByText('Publishing selected source');
  expect(adapter.start).toHaveBeenCalledWith(
    expect.objectContaining({
      audioMode: 'process',
      audioProcessId: 42,
      audioProcessCreatedAt: source.creationTime,
    }),
  );
  expect(JSON.stringify(server.calls)).not.toContain(source.label);
  expect(JSON.stringify(server.calls)).not.toContain('audioProcess');
  expect(JSON.stringify(server.calls)).not.toContain(source.creationTime);
  expect(mode.hasAttribute('disabled')).toBe(true);
  view.unmount();
});

it('keeps denied/empty application choices explicit and never falls back to system audio', async () => {
  const list = mock(
    async (): Promise<AudioSourcesResponse> => ({ state: 'unavailable', sources: [] }),
  );
  const view = render(<Choices adapter={publisher(list)} />);
  const mode = screen.getByRole('combobox', { name: 'Audio source' });
  fireEvent.change(mode, { target: { value: 'system' } });
  expect(list).not.toHaveBeenCalled();
  fireEvent.change(mode, { target: { value: 'process' } });
  await screen.findByText(
    'Application choices are unavailable. Retry explicitly or leave audio off. No fallback source was selected.',
  );
  expect((mode as HTMLSelectElement).value).toBe('process');
  list.mockResolvedValueOnce({ state: 'ready', sources: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Choose audio application' }));
  await screen.findByText(
    'No accessible visible application was found. Open its window and choose again.',
  );
  list.mockRejectedValueOnce(new Error('Synthetic permission denial'));
  fireEvent.click(screen.getByRole('button', { name: 'Choose audio application' }));
  await screen.findByText(
    'Application choices are unavailable. Retry explicitly or leave audio off. No fallback source was selected.',
  );
  fireEvent.change(mode, { target: { value: 'off' } });
  expect(screen.queryByRole('combobox', { name: 'Application for audio' })).toBeNull();
  view.unmount();
});

it('discards delayed local descriptors after mode changes or unmount', async () => {
  let resolve: ((value: AudioSourcesResponse) => void) | undefined;
  const list = mock(
    () =>
      new Promise<AudioSourcesResponse>((done) => {
        resolve = done;
      }),
  );
  const view = render(<Choices adapter={publisher(list)} />);
  const mode = screen.getByRole('combobox', { name: 'Audio source' });
  fireEvent.change(mode, { target: { value: 'process' } });
  fireEvent.change(mode, { target: { value: 'off' } });
  await act(async () => {
    resolve?.({ state: 'ready', sources: [source] });
  });
  expect(screen.queryByText(/Synthetic private local title/)).toBeNull();
  fireEvent.change(mode, { target: { value: 'process' } });
  view.unmount();
  await act(async () => {
    resolve?.({ state: 'ready', sources: [source] });
  });
  expect(list).toHaveBeenCalledTimes(2);
});
