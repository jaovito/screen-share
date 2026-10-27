import type { UpdateInfo, UpdaterAdapter } from '@screen-share/ui/product';
import { invoke, isTauri } from '@tauri-apps/api/core';

function parseUpdate(value: unknown): UpdateInfo {
  if (!value || typeof value !== 'object' || !('state' in value) || !('version' in value))
    throw new Error('Invalid update response');

  const { state, version } = value;
  if (state === 'available') {
    if (typeof version !== 'string' || !/^[A-Za-z0-9.+-]{1,96}$/.test(version))
      throw new Error('Invalid update version');
    return { state, version };
  }
  if ((state === 'notConfigured' || state === 'upToDate') && version === null)
    return { state, version };

  throw new Error('Invalid update state');
}

const updater: UpdaterAdapter = {
  async check() {
    return parseUpdate(await invoke<unknown>('check_updates'));
  },
  async install() {
    await invoke('install_update', { confirmed: true });
  },
};

export function desktopUpdater(): UpdaterAdapter | undefined {
  return isTauri() ? updater : undefined;
}
