import { z } from 'zod';

const nullable = (maximum: number) => z.number().nonnegative().max(maximum).nullable();
export const receiverMetricsSchema = z
  .object({
    intervalMs: z.number().positive().max(10_000),
    decodedFps: nullable(1000),
    inboundBitrateBps: nullable(1_000_000_000),
    droppedFrames: z.number().int().nonnegative().max(1_000_000).nullable(),
    averageDecodeMs: nullable(60_000),
    packetLossRatio: nullable(1),
    jitterMs: nullable(60_000),
    transportRttMs: nullable(60_000),
    width: z.number().int().positive().max(16_384).nullable(),
    height: z.number().int().positive().max(16_384).nullable(),
  })
  .strict();
export const receiverReportSchema = z
  .object({
    sessionId: z.uuid(),
    epoch: z.number().int().positive(),
    reportId: z.uuid(),
    sequence: z.number().int().positive(),
    metrics: receiverMetricsSchema,
  })
  .strict();
export const peerReportSchema = receiverReportSchema
  .omit({ sessionId: true, epoch: true })
  .extend({
    userId: z.uuid(),
    receivedAt: z.number().int().nonnegative(),
  })
  .strict();
export const peerReportsSchema = z
  .object({
    sessionId: z.uuid(),
    epoch: z.number().int().positive(),
    reports: z.array(peerReportSchema).max(7),
  })
  .strict();
export const reportAcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
export type ReceiverReport = z.infer<typeof receiverReportSchema>;
export type PeerReport = z.infer<typeof peerReportSchema>;
export type PeerReports = z.infer<typeof peerReportsSchema>;
