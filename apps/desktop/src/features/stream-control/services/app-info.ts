import { type AppInfoDto, appInfoSchema } from '@screen-share/contracts';
import { invoke, isTauri } from '@tauri-apps/api/core';

export async function readAppInfo(): Promise<AppInfoDto> {
  if (!isTauri())
    throw new Error('Browser preview. Open the Tauri shell on Windows to query the native client.');

  return appInfoSchema.parse(await invoke<unknown>('get_app_info'));
}
