import { z } from 'zod';
import { mediaProofServerSchema } from './media-proof';
import { nativeFailureSchema } from './native-failure';

export const productUserSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  email: z.email(),
});
export const productMembershipSchema = z.enum(['owner', 'approved', 'pending']);
export const roomStateSchema = z.enum(['idle', 'preparing', 'active', 'closing', 'closed']);
export const roomSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  ownerId: z.uuid(),
  epoch: z.number().int().nonnegative(),
  membershipRevision: z.number().int().positive(),
  membership: productMembershipSchema,
  state: roomStateSchema,
  createdAt: z.iso.datetime(),
});
export const roomMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string().min(1).max(100),
  status: z.enum(['approved', 'pending']),
  role: z.enum(['owner', 'viewer']),
});
export const productSessionSchema = z.object({
  id: z.uuid(),
  epoch: z.number().int().positive(),
  membershipRevision: z.number().int().positive(),
  publisherId: z.uuid(),
  state: z.enum(['preparing', 'active', 'closing', 'closed', 'abandoned']),
  createdAt: z.iso.datetime(),
});
export const roomSnapshotSchema = z.object({
  room: roomSummarySchema,
  members: z.array(roomMemberSchema).min(1).max(8),
  session: productSessionSchema.nullable(),
  cleanupPending: z.boolean(),
});
export const roomListSchema = z.object({ rooms: z.array(roomSummarySchema) });
export const createRoomSchema = z.strictObject({ name: z.string().trim().min(1).max(80) });
export const createInviteSchema = z.strictObject({
  expiresInMinutes: z.number().int().min(1).max(1440),
  maxUses: z.number().int().min(1).max(7),
});
export const acceptInviteSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const inviteCreatedSchema = z.object({
  id: z.uuid(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(),
  maxUses: z.number().int().min(1).max(7),
});
export const inviteAcceptedSchema = z.object({ roomId: z.uuid(), status: z.literal('pending') });
export const sessionTransitionSchema = z.strictObject({
  epoch: z.number().int().positive(),
  membershipRevision: z.number().int().positive(),
});
export const requestProductGrantSchema = z.strictObject({
  role: z.enum(['publisher', 'viewer']),
  includeAudio: z.boolean().optional().default(false),
  sessionId: z.uuid(),
  epoch: z.number().int().positive(),
});
export const productMediaGrantSchema = z.strictObject({
  version: z.literal(1),
  sessionId: z.uuid(),
  epoch: z.number().int().positive(),
  rtcRoom: z
    .string()
    .refine((value) => value.startsWith('ss-') && z.uuid().safeParse(value.slice(3)).success),
  participantId: z.uuid(),
  publisherId: z.uuid(),
  role: z.enum(['publisher', 'viewer']),
  serverUrl: mediaProofServerSchema,
  accessToken: z.string().min(20).max(8192),
  expiresAt: z.number().int().positive(),
});
export const productGrantResponseSchema = z.object({ grant: productMediaGrantSchema });

export type ProductUser = z.infer<typeof productUserSchema>;
export type RoomSummary = z.infer<typeof roomSummarySchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export type ProductSession = z.infer<typeof productSessionSchema>;
export type ProductMediaGrant = z.infer<typeof productMediaGrantSchema>;

export const nativeSharingStatusSchema = z.object({
  state: z.enum([
    'idle',
    'selecting',
    'connecting',
    'sharing',
    'paused',
    'stopped',
    'failed',
    'unsupported_platform',
    'engine_missing',
  ]),
  profileId: z.string().nullable(),
  elapsedMs: z.number().nonnegative(),
  framesCaptured: z.number().nonnegative(),
  framesEncoded: z.number().nonnegative(),
  encodedBytes: z.number().nonnegative(),
  queueReplacements: z.number().nonnegative(),
  captureFps: z.number().nonnegative().nullable(),
  encodedFps: z.number().nonnegative().nullable(),
  targetFps: z.number().nonnegative().nullable(),
  audioSupported: z.boolean(),
  audioSamples: z.number().nonnegative().optional(),
  adaptationReason: z.enum(['network_pressure', 'network_headroom']).nullable().optional(),
  qualityChanges: z.number().int().nonnegative().optional(),
  targetBitrateBps: z.number().int().min(64_000).max(50_000_000).nullable().optional(),
  captureRecoveries: z.number().int().min(0).max(3).optional(),
  diagnosticsGeneration: z.number().int().nonnegative().optional(),
  diagnosticsElapsedMs: z.number().int().nonnegative().optional(),
  conversionSubmissionMs: z.number().min(0).max(60_000).nullable().optional(),
  encoderOutputLatencyMs: z.number().min(0).max(60_000).nullable().optional(),
  availableSendBitrateBps: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
  manualBitrateBps: z.number().int().min(64_000).max(50_000_000).nullable().optional(),
  reason: z.string().nullable(),
  failure: nativeFailureSchema.nullable().optional(),
  encryption: z.enum(['pending', 'configured']),
});
export type NativeSharingStatus = z.infer<typeof nativeSharingStatusSchema>;

export const controlResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: z.unknown(),
});
export type ControlResponse = z.infer<typeof controlResponseSchema>;

export const roomInviteMetadataSchema = z.object({
  id: z.uuid(),
  expiresAt: z.iso.datetime(),
  maxUses: z.number().int().min(1).max(7),
  uses: z.number().int().nonnegative(),
  revoked: z.boolean(),
});
export const roomInvitesResponseSchema = z.object({
  invites: z.array(roomInviteMetadataSchema).max(100),
});
