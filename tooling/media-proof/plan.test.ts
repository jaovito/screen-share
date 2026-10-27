import { expect, it } from 'bun:test';
import { mediaProofPlanSchema } from './plan';

const publisherId = '83c97c34-e315-43ea-8bcf-bcb90d03f9db';
const viewerId = 'fe15d838-70a2-4fda-b38c-40c7a5e98ec2';
const plan = {
  sessionId: publisherId,
  epoch: 1,
  participants: [
    { id: publisherId, role: 'publisher' },
    { id: viewerId, role: 'viewer' },
  ],
};

it('bounds the explicit allowlist to one publisher and two through eight distinct identities', () => {
  expect(mediaProofPlanSchema.safeParse(plan).success).toBe(true);
  for (const invalid of [
    { ...plan, epoch: 0 },
    { ...plan, participants: [] },
    { ...plan, participants: [plan.participants[0]] },
    { ...plan, participants: [plan.participants[0], plan.participants[0]] },
    {
      ...plan,
      participants: [
        { id: publisherId, role: 'viewer' },
        { id: viewerId, role: 'viewer' },
      ],
    },
    {
      ...plan,
      participants: Array.from({ length: 9 }, (_, i) => ({
        id: crypto.randomUUID(),
        role: i ? 'viewer' : 'publisher',
      })),
    },
    { ...plan, extra: true },
  ])
    expect(mediaProofPlanSchema.safeParse(invalid).success).toBe(false);
});
