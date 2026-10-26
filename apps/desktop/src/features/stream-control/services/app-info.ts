import { type AppInfoDto, appInfoSchema } from '@screen-share/contracts';
import { invoke, isTauri } from '@tauri-apps/api/core';

export async function readAppInfo(): Promise<AppInfoDto> {
  if (!isTauri())
    throw new Error(
      'Prévia no navegador. Abra o shell Tauri no Windows para consultar o cliente nativo.',
    );

  return appInfoSchema.parse(await invoke<unknown>('get_app_info'));
}
