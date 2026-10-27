import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { RtcControl } from '../application/ports';

export function createRtcControl(url: string, apiKey: string, apiSecret: string): RtcControl {
  const client = new RoomServiceClient(url, apiKey, apiSecret, { requestTimeout: 4 });
  return {
    async remove(room) {
      try {
        await client.deleteRoom(room);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'not_found') return;
        throw new Error('RTC cleanup unavailable');
      }
    },
    async token(input) {
      const ttl = input.expiresAt - Math.floor(Date.now() / 1000);
      if (ttl <= 0 || ttl > 60) throw new Error('Invalid grant lifetime');
      const publisher = input.role === 'publisher';
      const token = new AccessToken(apiKey, apiSecret, { identity: input.participantId, ttl });
      token.addGrant({
        room: input.rtcRoom,
        roomJoin: true,
        roomCreate: false,
        roomList: false,
        roomAdmin: false,
        roomRecord: false,
        ingressAdmin: false,
        canPublish: publisher,
        ...(publisher
          ? {
              canPublishSources: input.includeAudio
                ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
                : [TrackSource.SCREEN_SHARE],
            }
          : {}),
        canSubscribe: !publisher,
        canPublishData: false,
        canUpdateOwnMetadata: false,
        canSubscribeMetrics: false,
        hidden: false,
        recorder: false,
      });
      return token.toJwt();
    },
  };
}
