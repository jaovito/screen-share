import { randomUUID } from 'node:crypto';
import { mediaProofGrantSchema, mediaProofServerSchema } from '@screen-share/contracts';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { z } from 'zod';
import { mediaProofPlanSchema } from './plan';

const credentialsSchema = z.strictObject({
  apiKey: z.string().regex(/^[a-zA-Z0-9_-]{12,}$/),
  apiSecret: z.string().min(32),
  serverUrl: mediaProofServerSchema,
});

/** Offline operator boundary, never mount this function as an HTTP token endpoint. */
export async function issueProofGrants(planInput: unknown, credentialsInput: unknown) {
  const plan = mediaProofPlanSchema.parse(planInput);
  const credentials = credentialsSchema.parse(credentialsInput);
  const publisher = plan.participants.find(({ role }) => role === 'publisher');
  if (!publisher) throw new Error('A publisher must be explicitly authorized.');

  const rtcRoom = `m1-${randomUUID()}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const grants = [];

  for (const participant of plan.participants) {
    const publishing = participant.role === 'publisher';
    const token = new AccessToken(credentials.apiKey, credentials.apiSecret, {
      identity: participant.id,
      ttl: 300,
    });
    token.addGrant({
      room: rtcRoom,
      roomJoin: true,
      roomCreate: false,
      roomList: false,
      roomAdmin: false,
      roomRecord: false,
      ingressAdmin: false,
      canPublish: publishing,
      ...(publishing ? { canPublishSources: [TrackSource.SCREEN_SHARE] } : {}),
      canSubscribe: !publishing,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      canSubscribeMetrics: false,
      hidden: false,
      recorder: false,
    });
    grants.push(
      mediaProofGrantSchema.parse({
        version: 1,
        sessionId: plan.sessionId,
        epoch: plan.epoch,
        rtcRoom,
        participantId: participant.id,
        publisherId: publisher.id,
        role: participant.role,
        serverUrl: credentials.serverUrl,
        accessToken: await token.toJwt(),
        expiresAt,
      }),
    );
  }

  return grants;
}
