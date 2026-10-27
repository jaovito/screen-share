import { profilesResponseSchema } from '@screen-share/contracts';
import { RoomServiceClient } from 'livekit-server-sdk';
import type { Config } from '../config';
import { log } from '../log';

export async function checkControlPlane(config: Config) {
  const base = `http://127.0.0.1:${config.PORT}`;

  for (const path of ['/healthz', '/readyz', '/v1/video-profiles']) {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) throw new Error('HTTP indisponível');

    const body: unknown = await response.json();

    if (path.endsWith('video-profiles')) profilesResponseSchema.parse(body);
  }

  const client = new RoomServiceClient(
    config.LIVEKIT_URL,
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
    { requestTimeout: 4 },
  );

  await client.listRooms();
  log('smoke_passed', { rtcMediaVerified: false });
}
