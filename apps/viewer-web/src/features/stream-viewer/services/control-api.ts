import { profilesResponseSchema, type VideoProfileDto } from '@screen-share/contracts';

export type ControlState =
  | { state: 'loading' }
  | { state: 'ready'; profiles: VideoProfileDto[] }
  | { state: 'unavailable' | 'error' };

export async function readControlState(signal: AbortSignal, retry: boolean): Promise<ControlState> {
  const base = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000';
  const [ready, response] = await Promise.all(
    ['/readyz', '/v1/video-profiles'].map((path) =>
      fetch(`${base}${path}`, {
        signal,
        cache: retry ? 'no-store' : 'default',
      }),
    ),
  );

  if (!ready?.ok || !response?.ok) return { state: 'unavailable' };

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return { state: 'error' };
  }

  const parsed = profilesResponseSchema.safeParse(body);

  return parsed.success ? { state: 'ready', profiles: parsed.data.profiles } : { state: 'error' };
}
