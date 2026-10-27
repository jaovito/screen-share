import { beforeEach, expect, it, mock } from 'bun:test';

const deleteRoom = mock(async (_room: string) => {});
const addGrant = mock((_grant: unknown) => {});
const clientOptions: unknown[] = [];
class Client {
  deleteRoom = deleteRoom;
  constructor(_url: string, _key: string, _secret: string, options: unknown) {
    clientOptions.push(options);
  }
}
class Token {
  addGrant = addGrant;
  async toJwt() {
    return 'synthetic-signed-token';
  }
}
mock.module('livekit-server-sdk', () => ({
  RoomServiceClient: Client,
  AccessToken: Token,
  TrackSource: { SCREEN_SHARE: 3, SCREEN_SHARE_AUDIO: 4 },
}));
const { createRtcControl } = await import('@modules/private-rooms/adapters/livekit');
beforeEach(() => {
  deleteRoom.mockReset();
  deleteRoom.mockResolvedValue();
  addGrant.mockClear();
  clientOptions.length = 0;
});
it('uses bounded administrative requests and handles already-deleted rooms idempotently', async () => {
  const rtc = createRtcControl('http://127.0.0.1:7880', 'synthetic', 'synthetic');
  expect(clientOptions[0]).toEqual({ requestTimeout: 4 });
  await rtc.remove('ss-synthetic');
  deleteRoom.mockRejectedValueOnce(Object.assign(new Error('not exposed'), { code: 'not_found' }));
  await rtc.remove('ss-synthetic');
  deleteRoom.mockRejectedValueOnce(new Error('private endpoint or credential'));
  await expect(rtc.remove('ss-synthetic')).rejects.toThrow('RTC cleanup unavailable');
});
it('signs only bounded least-privilege screen-share and receive-only grants', async () => {
  const rtc = createRtcControl('http://127.0.0.1:7880', 'synthetic', 'synthetic');
  const input = {
    rtcRoom: 'ss-synthetic',
    participantId: 'synthetic',
    role: 'publisher' as const,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
  expect(await rtc.token(input)).toBe('synthetic-signed-token');
  expect(addGrant).toHaveBeenLastCalledWith(
    expect.objectContaining({
      canPublish: true,
      canSubscribe: false,
      canPublishData: false,
      canPublishSources: [3],
      roomAdmin: false,
    }),
  );
  await rtc.token({ ...input, includeAudio: true });
  expect(addGrant).toHaveBeenLastCalledWith(expect.objectContaining({ canPublishSources: [3, 4] }));
  await rtc.token({ ...input, role: 'viewer' });
  expect(addGrant).toHaveBeenLastCalledWith(
    expect.objectContaining({ canPublish: false, canSubscribe: true, canPublishData: false }),
  );
  for (const expiresAt of [0, Math.floor(Date.now() / 1000) + 61])
    await expect(rtc.token({ ...input, expiresAt })).rejects.toThrow('Invalid grant lifetime');
});
