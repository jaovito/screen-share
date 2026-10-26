import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    state: text('state', { enum: ['idle', 'closed'] })
      .notNull()
      .default('idle'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('rooms_state_check', sql`${table.state} in ('idle', 'closed')`),
    check('rooms_owner_check', sql`length(trim(${table.ownerId})) > 0`),
  ],
);
