import {
  audioSourcesResponseSchema,
  controlResponseSchema,
  nativeSharingStatusSchema,
} from '@screen-share/contracts';
import type { ProductControlTransport, PublisherAdapter } from '@screen-share/ui/product';
import { invoke, isTauri } from '@tauri-apps/api/core';

async function command(name: string, args?: Record<string, unknown>) {
  return nativeSharingStatusSchema.parse(await invoke<unknown>(name, args));
}

const publisher: PublisherAdapter = {
  managesAuthorization: true,
  start: ({ roomId, ...request }) => command('start_sharing', { roomId, request }),
  renew: (grant, profileId, bitrateBps) =>
    command('renew_sharing', { grant, ...(profileId ? { profileId, bitrateBps } : {}) }),
  stop: () => command('stop_sharing'),
  pause: () => command('pause_sharing'),
  resume: () => command('resume_sharing'),
  status: () => command('get_sharing_status'),
  audioSources: async () =>
    audioSourcesResponseSchema.parse(await invoke<unknown>('list_audio_sources')),
};

export function desktopPublisher() {
  return isTauri() ? publisher : undefined;
}

const control: ProductControlTransport = async ({ method, path, body, signal }) => {
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  const response = controlResponseSchema.parse(
    await invoke<unknown>('control_request', {
      request: { method, path, ...(body ? { body } : {}) },
    }),
  );
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  return response;
};

export function desktopControl() {
  return isTauri() ? control : undefined;
}
