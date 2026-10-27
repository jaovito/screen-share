import { expect, it } from 'bun:test';
import { peerReportsSchema, receiverReportSchema } from '../src';

const id = '11111111-1111-4111-8111-111111111111';
const input = {
  sessionId: id,
  epoch: 1,
  reportId: id,
  sequence: 1,
  metrics: {
    intervalMs: 1000,
    decodedFps: 30,
    inboundBitrateBps: 1_000_000,
    droppedFrames: 0,
    averageDecodeMs: 4,
    packetLossRatio: 0,
    jitterMs: 2,
    transportRttMs: 20,
    width: 1280,
    height: 720,
  },
};
it('permits only compact bounded numeric client observations without identities or secrets', () => {
  expect(receiverReportSchema.safeParse(input).success).toBe(true);
  for (const patch of [
    { sequence: 0 },
    { sequence: 1.5 },
    { userId: id },
    { mediaKey: 'private' },
    { metrics: { ...input.metrics, ip: '127.0.0.1' } },
    { metrics: { ...input.metrics, decodedFps: Infinity } },
    { metrics: { ...input.metrics, packetLossRatio: 1.1 } },
    { metrics: { ...input.metrics, intervalMs: 0 } },
  ])
    expect(receiverReportSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  expect(peerReportsSchema.safeParse({ sessionId: id, epoch: 1, reports: [] }).success).toBe(true);
});
