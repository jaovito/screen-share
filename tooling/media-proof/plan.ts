import { z } from 'zod';

const participantSchema = z.strictObject({
  id: z.uuid(),
  role: z.enum(['publisher', 'viewer']),
});

export const mediaProofPlanSchema = z
  .strictObject({
    sessionId: z.uuid(),
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    participants: z.array(participantSchema).min(2).max(8),
  })
  .refine(
    ({ participants }) =>
      new Set(participants.map(({ id }) => id)).size === participants.length &&
      participants.filter(({ role }) => role === 'publisher').length === 1,
    'A proof needs one publisher and unique explicitly authorized participants.',
  );

export type MediaProofPlan = z.infer<typeof mediaProofPlanSchema>;
