import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import type { Config } from '../src/config.js';
import { videoProfiles } from '../src/modules/profiles/domain/profiles.js';

const listRooms = mock();

mock.module('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    listRooms = listRooms;
  },
}));

const { checkControlPlane } = await import('../src/runtime/smoke.js');

const config: Config = {
  DATABASE_URL: 'postgres://unused',
  HOST: '127.0.0.1',
  PORT: 3000,
  CORS_ORIGINS: [],
  LIVEKIT_URL: 'http://127.0.0.1:7880',
  LIVEKIT_API_KEY: 'unused-key',
  LIVEKIT_API_SECRET: 'unused-secret',
};

afterEach(() => {
  mock.restore();
});

it('checks health/readiness/catalog and performs only a read in LiveKit', async () => {
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      mock(
        async (url: Parameters<typeof fetch>[0]) =>
          new Response(
            JSON.stringify(
              String(url).endsWith('video-profiles')
                ? { profiles: videoProfiles }
                : { status: 'ready' },
            ),
          ),
      ),
      { preconnect: mock() },
    ),
  );
  listRooms.mockResolvedValue([]);

  const logger = spyOn(console, 'log').mockImplementation(() => {});

  await checkControlPlane(config);
  expect(listRooms).toHaveBeenCalled();
  expect(logger).toHaveBeenCalledWith(expect.stringContaining('"rtcMediaVerified":false'));
});

it('fails on HTTP unavailability before calling LiveKit', async () => {
  listRooms.mockClear();
  spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
  await expect(checkControlPlane(config)).rejects.toThrow('HTTP indisponível');
  expect(listRooms).not.toHaveBeenCalled();
});
