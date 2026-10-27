import { createHash, randomUUID } from 'node:crypto';
import type { RoomSummary } from '@screen-share/contracts';
import type pg from 'pg';
import type {
  Invite,
  Member,
  RoomRecord,
  RoomStore,
  RoomTransaction,
  SessionRecord,
} from '../application/ports';
import { RoomError } from '../domain/policy';
import { createCleanupProcessor } from './cleanup-outbox';

type RoomRow = Omit<RoomRecord, 'createdAt'> & { createdAt: Date };
type SessionRow = Omit<SessionRecord, 'createdAt'> & { createdAt: Date };
const roomColumns =
  'id,name,owner_id AS "ownerId",epoch,membership_revision AS "membershipRevision",state,created_at AS "createdAt"';
const sessionColumns =
  'id,epoch,membership_revision AS "membershipRevision",publisher_id AS "publisherId",rtc_room AS "rtcRoom",state,created_at AS "createdAt"';

export function createRoomStore(pool: pg.Pool): RoomStore {
  return {
    async create(id, name, ownerId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Serialize each owner's quota independently of room locks. A concurrent
        // create cannot pass the same final slot on two database connections.
        await client.query('SELECT id FROM auth_user WHERE id=$1 FOR UPDATE', [ownerId]);
        const owned = await client.query<{ count: string }>(
          'SELECT count(*) FROM private_rooms WHERE owner_id=$1',
          [ownerId],
        );
        if (Number(owned.rows[0]?.count) >= 20) throw new RoomError('room_limit', 409);
        await client.query('INSERT INTO private_rooms(id,name,owner_id) VALUES($1,$2,$3)', [
          id,
          name,
          ownerId,
        ]);
        await client.query(
          "INSERT INTO room_members(room_id,user_id,status,role) VALUES($1,$2,'approved','owner')",
          [id, ownerId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async list(actorId) {
      const result = await pool.query<RoomRow & { membership: RoomSummary['membership'] }>(
        `SELECT r.id,r.name,r.owner_id AS "ownerId",r.epoch,r.membership_revision AS "membershipRevision",r.state,r.created_at AS "createdAt",CASE WHEN m.role='owner' THEN 'owner' ELSE m.status END AS membership FROM private_rooms r JOIN room_members m ON m.room_id=r.id WHERE m.user_id=$1 ORDER BY r.created_at DESC LIMIT 100`,
        [actorId],
      );
      return result.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    },
    async inviteRoom(hash) {
      const result = await pool.query<{ roomId: string }>(
        'SELECT room_id AS "roomId" FROM room_invites WHERE token_hash=$1',
        [hash],
      );
      return result.rows[0]?.roomId ?? null;
    },
    async locked(roomId, work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<RoomRow>(
          `SELECT ${roomColumns} FROM private_rooms WHERE id=$1 FOR UPDATE`,
          [roomId],
        );
        const row = result.rows[0];
        if (!row) throw new RoomError('not_found', 404);
        const members = await client.query<Member>(
          `SELECT m.user_id AS "userId",u.name,m.status,m.role FROM room_members m JOIN auth_user u ON u.id=m.user_id WHERE m.room_id=$1 ORDER BY m.joined_at,m.user_id`,
          [roomId],
        );
        const sessions = await client.query<SessionRow>(
          `SELECT ${sessionColumns} FROM media_sessions WHERE room_id=$1 ORDER BY epoch DESC LIMIT 1`,
          [roomId],
        );
        const current = sessions.rows[0];
        const tx = transaction(
          client,
          { ...row, createdAt: row.createdAt.toISOString() },
          members.rows,
          current ? { ...current, createdAt: current.createdAt.toISOString() } : null,
        );
        const value = await work(tx);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async consumeLimit(key, windowSeconds, maximum) {
      const opaque = createHash('sha256').update(key).digest('hex');
      const bucket = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds;
      const result = await pool.query<{ count: number }>(
        `INSERT INTO request_limits(key,count,window_start) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.window_start=$2 THEN request_limits.count+1 ELSE 1 END,window_start=$2 RETURNING count`,
        [opaque, bucket],
      );
      return {
        allowed: (result.rows[0]?.count ?? maximum + 1) <= maximum,
        retryAfter: windowSeconds - (Math.floor(Date.now() / 1000) - bucket),
      };
    },
    processCleanup: createCleanupProcessor(pool),
  };
}

function transaction(
  client: pg.PoolClient,
  room: RoomRecord,
  members: Member[],
  session: SessionRecord | null,
): RoomTransaction {
  const tx: RoomTransaction = {
    room,
    members,
    session,
    async updateRoom(update) {
      Object.assign(room, update);
      await client.query(
        'UPDATE private_rooms SET epoch=$2,membership_revision=$3,state=$4 WHERE id=$1',
        [room.id, room.epoch, room.membershipRevision, room.state],
      );
    },
    async addMember(userId) {
      await client.query(
        "INSERT INTO room_members(room_id,user_id,status,role) VALUES($1,$2,'pending','viewer')",
        [room.id, userId],
      );
      const user = await client.query<{ name: string }>('SELECT name FROM auth_user WHERE id=$1', [
        userId,
      ]);
      const name = user.rows[0]?.name;
      if (!name) throw new RoomError('unauthorized', 401);
      members.push({ userId, name, status: 'pending', role: 'viewer' });
    },
    async approveMember(userId) {
      await client.query(
        "UPDATE room_members SET status='approved' WHERE room_id=$1 AND user_id=$2",
        [room.id, userId],
      );
      const member = members.find((entry) => entry.userId === userId);
      if (member) member.status = 'approved';
    },
    async removeMember(userId) {
      await client.query('DELETE FROM room_members WHERE room_id=$1 AND user_id=$2', [
        room.id,
        userId,
      ]);
      const index = members.findIndex((entry) => entry.userId === userId);
      if (index >= 0) members.splice(index, 1);
    },
    async inviteByHash(hash) {
      const result = await client.query<
        Omit<Invite, 'expiresAt' | 'revoked'> & { expiresAt: Date; revoked: number }
      >(
        'SELECT id,room_id AS "roomId",token_hash AS "tokenHash",expires_at AS "expiresAt",max_uses AS "maxUses",uses,revoked FROM room_invites WHERE token_hash=$1 AND room_id=$2 FOR UPDATE',
        [hash, room.id],
      );
      const value = result.rows[0];
      return value
        ? { ...value, expiresAt: value.expiresAt.getTime(), revoked: value.revoked !== 0 }
        : null;
    },
    async insertInvite(invite) {
      await client.query(
        'INSERT INTO room_invites(id,room_id,token_hash,expires_at,max_uses) VALUES($1,$2,$3,$4,$5)',
        [invite.id, room.id, invite.tokenHash, new Date(invite.expiresAt), invite.maxUses],
      );
    },
    async useInvite(id) {
      await client.query('UPDATE room_invites SET uses=uses+1 WHERE id=$1 AND room_id=$2', [
        id,
        room.id,
      ]);
    },
    async revokeInvite(id) {
      const result = await client.query(
        'UPDATE room_invites SET revoked=1 WHERE id=$1 AND room_id=$2',
        [id, room.id],
      );
      return result.rowCount === 1;
    },
    async listInvites() {
      const rows = await client.query<{
        id: string;
        expiresAt: Date;
        maxUses: number;
        uses: number;
        revoked: number;
      }>(
        'SELECT id,expires_at AS "expiresAt",max_uses AS "maxUses",uses,revoked FROM room_invites WHERE room_id=$1 ORDER BY revoked,expires_at DESC LIMIT 100',
        [room.id],
      );
      return rows.rows.map((entry) => ({
        ...entry,
        expiresAt: entry.expiresAt.getTime(),
        revoked: entry.revoked !== 0,
      }));
    },
    async setSession(value) {
      await client.query(
        'INSERT INTO media_sessions(id,room_id,rtc_room,epoch,membership_revision,publisher_id,state) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          value.id,
          room.id,
          value.rtcRoom,
          value.epoch,
          value.membershipRevision,
          value.publisherId,
          value.state,
        ],
      );
      tx.session = value;
    },
    async updateSession(state) {
      if (!tx.session) throw new RoomError('stale_session', 409);
      await client.query('UPDATE media_sessions SET state=$2 WHERE id=$1', [tx.session.id, state]);
      tx.session.state = state;
    },
    async enqueueCleanup(value) {
      await client.query(
        'INSERT INTO rtc_cleanup_outbox(id,room_id,session_id,rtc_room) VALUES($1,$2,$3,$4) ON CONFLICT(session_id) DO NOTHING',
        [randomUUID(), room.id, value.id, value.rtcRoom],
      );
    },
    async cleanupPending() {
      const result = await client.query<{ pending: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM rtc_cleanup_outbox WHERE room_id=$1 AND completed_at IS NULL) AS pending',
        [room.id],
      );
      return result.rows[0]?.pending ?? true;
    },
    async audit(actorId, action) {
      await client.query('INSERT INTO room_audit(id,room_id,actor_id,action) VALUES($1,$2,$3,$4)', [
        randomUUID(),
        room.id,
        actorId,
        action,
      ]);
    },
  };
  return tx;
}
