import { z } from 'zod';

export const mediaProofServerSchema = z.url().refine((value) => {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);

  return (
    (url.protocol === 'wss:' || (url.protocol === 'ws:' && loopback)) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}, 'Use WSS, or WS on loopback only, without URL credentials.');

// This validates a client envelope, not the JWT signature or membership authorization.
// The SFU verifies the signature; only a trusted operator may issue proof grants.
export const mediaProofGrantSchema = z
  .strictObject({
    version: z.literal(1),
    sessionId: z.uuid(),
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    rtcRoom: z.string().regex(/^m1-[a-f0-9-]{36}$/),
    participantId: z.uuid(),
    publisherId: z.uuid(),
    role: z.enum(['publisher', 'viewer']),
    serverUrl: mediaProofServerSchema,
    accessToken: z
      .string()
      .min(20)
      .max(8192)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .refine(
    ({ role, participantId, publisherId }) =>
      (role === 'publisher') === (participantId === publisherId),
    'Participant role must match the designated publisher.',
  );

export type MediaProofGrant = z.infer<typeof mediaProofGrantSchema>;
