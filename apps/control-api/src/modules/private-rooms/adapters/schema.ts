import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '../../identity/adapters/schema';

export const privateRooms = pgTable(
  'private_rooms',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    epoch: integer('epoch').notNull().default(0),
    membershipRevision: integer('membership_revision').notNull().default(1),
    state: text('state').notNull().default('idle'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('private_room_name', sql`length(trim(${t.name})) between 1 and 80`),
    check(
      'private_room_state',
      sql`${t.state} in ('idle','preparing','active','closing','closed')`,
    ),
    check('private_room_epoch', sql`${t.epoch} >= 0 AND ${t.membershipRevision} > 0`),
  ],
);

export const roomMembers = pgTable(
  'room_members',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => privateRooms.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    status: text('status').notNull(),
    role: text('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.userId] }),
    check('member_status', sql`${t.status} in ('approved','pending')`),
    check('member_role', sql`${t.role} in ('owner','viewer')`),
    uniqueIndex('one_room_owner').on(t.roomId).where(sql`${t.role}='owner'`),
  ],
);

export const roomInvites = pgTable(
  'room_invites',
  {
    id: uuid('id').primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => privateRooms.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maxUses: integer('max_uses').notNull(),
    uses: integer('uses').notNull().default(0),
    revoked: integer('revoked').notNull().default(0),
  },
  (t) => [
    check(
      'invite_limit',
      sql`${t.maxUses} between 1 and 7 AND ${t.uses} between 0 and ${t.maxUses}`,
    ),
  ],
);

export const mediaSessions = pgTable(
  'media_sessions',
  {
    id: uuid('id').primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => privateRooms.id),
    rtcRoom: text('rtc_room').notNull().unique(),
    epoch: integer('epoch').notNull(),
    membershipRevision: integer('membership_revision').notNull(),
    publisherId: text('publisher_id')
      .notNull()
      .references(() => user.id),
    state: text('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('room_epoch_unique').on(t.roomId, t.epoch),
    check(
      'media_session_state',
      sql`${t.state} in ('preparing','active','closing','closed','abandoned')`,
    ),
  ],
);

export const cleanupOutbox = pgTable(
  'rtc_cleanup_outbox',
  {
    id: uuid('id').primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => privateRooms.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => mediaSessions.id),
    rtcRoom: text('rtc_room').notNull(),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('cleanup_session_unique').on(t.sessionId),
    index('cleanup_pending_idx').on(t.availableAt),
  ],
);

export const roomAudit = pgTable('room_audit', {
  id: uuid('id').primaryKey(),
  roomId: uuid('room_id')
    .notNull()
    .references(() => privateRooms.id),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const requestLimits = pgTable('request_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: bigint('window_start', { mode: 'number' }).notNull(),
});
