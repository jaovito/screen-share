import { expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as identity from '@modules/identity/adapters/schema';
import * as product from '@modules/private-rooms/adapters/schema';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { account, app, createRoom, database } from './product-support';

it('applies the declared identity indexes, foreign keys, and room/session constraints', async () => {
  for (const table of [...Object.values(identity), ...Object.values(product)]) {
    const config = getTableConfig(table);
    const actual = await database.pool.query<{ constraint_name: string }>(
      "SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema='public' AND table_name=$1 AND constraint_type='FOREIGN KEY'",
      [config.name],
    );
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      expect(reference.columns.every((column) => column.notNull)).toBe(true);
      expect(actual.rows.map((row) => row.constraint_name)).toContain(foreignKey.getName());
    }
  }

  expect(getTableConfig(identity.account).indexes).toHaveLength(1);
  expect(getTableConfig(identity.session).indexes).toHaveLength(1);
  expect(getTableConfig(product.privateRooms).checks.map((check) => check.name)).toContain(
    'private_room_state',
  );
  expect(getTableConfig(product.roomMembers).indexes.map((index) => index.config.name)).toContain(
    'one_room_owner',
  );
  expect(getTableConfig(product.roomInvites).checks.map((check) => check.name)).toContain(
    'invite_limit',
  );
  expect(getTableConfig(product.mediaSessions).indexes.map((index) => index.config.name)).toContain(
    'room_epoch_unique',
  );
  expect(getTableConfig(product.cleanupOutbox).indexes.map((index) => index.config.name)).toContain(
    'cleanup_session_unique',
  );
  expect(getTableConfig(product.roomAudit).foreignKeys).toHaveLength(1);
  expect(getTableConfig(product.requestLimits).columns).toHaveLength(3);
  const owner = await account();
  const room = await createRoom(owner.cookie);
  await expect(
    database.pool.query("UPDATE private_rooms SET state='unexpected' WHERE id=$1", [room.room.id]),
  ).rejects.toThrow();
  await expect(
    database.pool.query("UPDATE private_rooms SET name=' ' WHERE id=$1", [room.room.id]),
  ).rejects.toThrow();
  await expect(
    database.pool.query('UPDATE private_rooms SET epoch=-1 WHERE id=$1', [room.room.id]),
  ).rejects.toThrow();
  await expect(
    database.pool.query("UPDATE room_members SET status='unexpected' WHERE room_id=$1", [
      room.room.id,
    ]),
  ).rejects.toThrow();
  await expect(
    database.pool.query("UPDATE room_members SET role='unexpected' WHERE room_id=$1", [
      room.room.id,
    ]),
  ).rejects.toThrow();
  await expect(
    database.pool.query(
      "INSERT INTO room_members(room_id,user_id,status,role) VALUES($1,$2,'approved','viewer')",
      [room.room.id, randomUUID()],
    ),
  ).rejects.toThrow();
  await expect(
    database.pool.query(
      'INSERT INTO room_invites(id,room_id,token_hash,expires_at,max_uses) VALUES($1,$2,$3,now(),8)',
      [randomUUID(), room.room.id, randomUUID()],
    ),
  ).rejects.toThrow();
  await expect(
    database.pool.query(
      "INSERT INTO media_sessions(id,room_id,rtc_room,epoch,membership_revision,publisher_id,state) VALUES($1,$2,$3,1,1,$4,'unexpected')",
      [randomUUID(), room.room.id, randomUUID(), owner.id],
    ),
  ).rejects.toThrow();
});

it('fails readiness when product storage is missing despite unchanged migration hashes', async () => {
  expect((await app.request('/readyz')).status).toBe(200);
  await database.pool.query('ALTER TABLE auth_session RENAME TO unavailable_session_fixture');
  try {
    expect((await app.request('/readyz')).status).toBe(503);
  } finally {
    await database.pool.query('ALTER TABLE unavailable_session_fixture RENAME TO auth_session');
  }
  expect((await app.request('/readyz')).status).toBe(200);
});
