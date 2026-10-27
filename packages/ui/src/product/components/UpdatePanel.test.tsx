import { beforeEach, expect, it, mock } from 'bun:test';
import { LocaleProvider, localeStorageKey } from '@screen-share/i18n';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { productTranslations } from '../locales';
import type { UpdateInfo, UpdaterAdapter } from '../types';
import { UpdatePanel } from './UpdatePanel';

beforeEach(() => {
  localStorage.setItem(localeStorageKey, 'en');
});
function panel(updater: UpdaterAdapter) {
  const view = render(
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <UpdatePanel updater={updater} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByText('App updates'));
  return view;
}

it('checks explicitly and requires separate restart consent before installing', async () => {
  const install = mock(async () => {});
  const check = mock(async (): Promise<UpdateInfo> => ({ state: 'available', version: '1.2.3' }));
  panel({ check, install });
  expect(check).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByText('Version 1.2.3 is available.');
  const button = screen.getByRole('button', { name: 'Install signed update and restart' });
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(button.hasAttribute('disabled')).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
});

it('reports an unconfigured feed and a current release without offering an installer', async () => {
  const check = mock(async (): Promise<UpdateInfo> => ({ state: 'notConfigured', version: null }));
  const install = mock(async () => {});
  panel({ check, install });
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByText('A signed release feed is not configured for this build.');
  check.mockResolvedValueOnce({ state: 'upToDate', version: null });
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByText('This release feed has no newer version.');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(install).not.toHaveBeenCalled();
});

it('clears availability and consent after an installer failure and permits a fresh check', async () => {
  const check = mock(async (): Promise<UpdateInfo> => ({ state: 'available', version: '2.0.0' }));
  const install = mock(async () => {
    throw new Error('Synthetic signature rejection');
  });
  panel({ check, install });
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByText('Version 2.0.0 is available.');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Install signed update and restart' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByText('Version 2.0.0 is available.');
  expect(
    screen
      .getByRole('button', { name: 'Install signed update and restart' })
      .hasAttribute('disabled'),
  ).toBe(true);
});

it('blocks overlapping operations and discards a check completed after unmount', async () => {
  let resolve: (info: UpdateInfo) => void = () => {};
  const check = mock(
    () =>
      new Promise<UpdateInfo>((done) => {
        resolve = done;
      }),
  );
  const view = panel({ check, install: mock(async () => {}) });
  const button = screen.getByRole('button', { name: 'Check for updates' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(check).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Processing update…')).toBeDefined();
  view.unmount();
  await act(async () => {
    resolve({ state: 'available', version: '1.0.0' });
  });
  expect(screen.queryByText('Version 1.0.0 is available.')).toBeNull();
});

it('reports a failed check and suppresses its late failure after cleanup', async () => {
  const check = mock(async (): Promise<UpdateInfo> => {
    throw new Error('Synthetic failure');
  });
  const view = panel({ check, install: mock(async () => {}) });
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByRole('alert');
  view.unmount();
  let reject: (reason: Error) => void = () => {};
  const late = panel({
    check: () =>
      new Promise<UpdateInfo>((_done, fail) => {
        reject = fail;
      }),
    install: async () => {},
  });
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  late.unmount();
  await act(async () => {
    reject(new Error('Late synthetic failure'));
  });
});
