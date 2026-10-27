import type { ProductMediaGrant, RoomSnapshot } from '@screen-share/contracts';
import { RoomError, requireCapacity, requireCurrentEpoch, requireOwner } from '../domain/policy';
import type { ProductDependencies, RoomTransaction, SessionRecord } from './ports';

export function createRoomService(deps: ProductDependencies) {
  const { store } = deps;

  function approved(tx: RoomTransaction, actor: string) {
    const member = tx.members.find((entry) => entry.userId === actor);
    if (member?.status !== 'approved') throw new RoomError('not_found', 404);
    return member;
  }

  async function snapshot(tx: RoomTransaction, actor: string): Promise<RoomSnapshot> {
    const member = approved(tx, actor);
    const cleanupPending = await tx.cleanupPending();
    const state = tx.room.state === 'closing' && !cleanupPending ? 'idle' : tx.room.state;
    const session = tx.session;
    return {
      room: { ...tx.room, state, membership: member.role === 'owner' ? 'owner' : 'approved' },
      members: tx.members,
      session: session
        ? {
            id: session.id,
            epoch: session.epoch,
            membershipRevision: session.membershipRevision,
            publisherId: session.publisherId,
            state: session.state,
            createdAt: session.createdAt,
          }
        : null,
      cleanupPending,
    };
  }

  async function retire(tx: RoomTransaction) {
    if (tx.session && !['closed', 'abandoned'].includes(tx.session.state)) {
      const previous = { ...tx.session };
      await tx.updateSession(previous.state === 'preparing' ? 'abandoned' : 'closing');
      await tx.enqueueCleanup(previous);
    }
  }

  async function rosterChanged(tx: RoomTransaction) {
    await retire(tx);
    await tx.updateRoom({
      membershipRevision: tx.room.membershipRevision + 1,
      state: (await tx.cleanupPending()) ? 'closing' : 'idle',
    });
  }

  return {
    list: (actor: string) => store.list(actor),
    async create(actor: string, name: string) {
      const id = deps.id();
      await store.create(id, name, actor);
      return store.locked(id, (tx) => snapshot(tx, actor));
    },
    get: (actor: string, roomId: string) =>
      store.locked(roomId, async (tx) => {
        const member = tx.members.find((entry) => entry.userId === actor);
        if (member?.status === 'pending')
          return {
            room: { ...tx.room, membership: 'pending' as const },
            members: [member],
            session: null,
            cleanupPending: false,
          };
        return snapshot(tx, actor);
      }),
    async invite(actor: string, roomId: string, expiresInMinutes: number, maxUses: number) {
      return store.locked(roomId, async (tx) => {
        approved(tx, actor);
        requireOwner(tx.room.ownerId, actor);
        const token = deps.secret();
        const invite = {
          id: deps.id(),
          roomId,
          tokenHash: deps.hash(token),
          expiresAt: deps.now() + expiresInMinutes * 60_000,
          maxUses,
          uses: 0,
          revoked: false,
        };
        await tx.insertInvite(invite);
        await tx.audit(actor, 'invite_created');
        return {
          id: invite.id,
          token,
          expiresAt: new Date(invite.expiresAt).toISOString(),
          maxUses,
        };
      });
    },
    async accept(actor: string, token: string) {
      const hash = deps.hash(token);
      const roomId = await store.inviteRoom(hash);
      if (!roomId) throw new RoomError('invalid_invite', 404);
      return store.locked(roomId, async (tx) => {
        const invite = await tx.inviteByHash(hash);
        if (
          !invite ||
          invite.revoked ||
          invite.expiresAt <= deps.now() ||
          invite.uses >= invite.maxUses ||
          tx.room.state === 'closed'
        )
          throw new RoomError('invalid_invite', 404);
        if (tx.members.some((member) => member.userId === actor))
          throw new RoomError('already_member', 409);
        requireCapacity(tx.members.length);
        await tx.addMember(actor);
        await tx.useInvite(invite.id);
        // Pending recipients must not receive keys or grants. Adding a pending
        // request does not invalidate the approved roster used by an active session.
        await tx.audit(actor, 'membership_requested');
        return { roomId, status: 'pending' as const };
      });
    },
    async listInvites(actor: string, roomId: string) {
      return store.locked(roomId, async (tx) => {
        approved(tx, actor);
        requireOwner(tx.room.ownerId, actor);
        return {
          invites: (await tx.listInvites()).map((entry) => ({
            ...entry,
            expiresAt: new Date(entry.expiresAt).toISOString(),
          })),
        };
      });
    },
    async revokeInvite(actor: string, roomId: string, inviteId: string) {
      return store.locked(roomId, async (tx) => {
        approved(tx, actor);
        requireOwner(tx.room.ownerId, actor);
        if (!(await tx.revokeInvite(inviteId))) throw new RoomError('not_found', 404);
        await tx.audit(actor, 'invite_revoked');
        return { ok: true };
      });
    },
    async approve(actor: string, roomId: string, memberId: string) {
      return store.locked(roomId, async (tx) => {
        approved(tx, actor);
        requireOwner(tx.room.ownerId, actor);
        const member = tx.members.find((entry) => entry.userId === memberId);
        if (!member) throw new RoomError('not_found', 404);
        if (member.status !== 'approved') {
          await tx.approveMember(memberId);
          await rosterChanged(tx);
          await tx.audit(actor, 'membership_approved');
        }
        return snapshot(tx, actor);
      });
    },
    async remove(actor: string, roomId: string, memberId: string) {
      return store.locked(roomId, async (tx) => {
        approved(tx, actor);
        requireOwner(tx.room.ownerId, actor);
        if (memberId === tx.room.ownerId) throw new RoomError('cannot_remove_owner', 409);
        const member = tx.members.find((entry) => entry.userId === memberId);
        if (!member) throw new RoomError('not_found', 404);
        await tx.removeMember(memberId);
        // Invalidate even a preparing candidate: a removed pending recipient
        // might already have received a key outside this service.
        await rosterChanged(tx);
        await tx.audit(actor, 'membership_revoked');
        return snapshot(tx, actor);
      });
    },
    async prepare(actor: string, roomId: string) {
      return store.locked(roomId, async (tx) => {
        approved(tx, actor);
        requireOwner(tx.room.ownerId, actor);
        if (['preparing', 'active', 'closed'].includes(tx.room.state))
          throw new RoomError('invalid_transition', 409);
        await retire(tx);
        const session: SessionRecord = {
          id: deps.id(),
          epoch: tx.room.epoch + 1,
          membershipRevision: tx.room.membershipRevision,
          publisherId: actor,
          rtcRoom: `ss-${deps.id()}`,
          state: 'preparing',
          createdAt: new Date(deps.now()).toISOString(),
        };
        await tx.setSession(session);
        await tx.updateRoom({ epoch: session.epoch, state: 'preparing' });
        await tx.audit(actor, 'session_prepared');
        return snapshot(tx, actor);
      });
    },
    async transition(
      actor: string,
      roomId: string,
      sessionId: string,
      epoch: number,
      revision: number,
      action: 'activate' | 'close',
    ) {
      return store.locked(roomId, async (tx) => {
        approved(tx, actor);
        requireOwner(tx.room.ownerId, actor);
        if (!tx.session || tx.session.id !== sessionId) throw new RoomError('stale_session', 409);
        requireCurrentEpoch(tx.room.epoch, epoch);
        if (tx.room.membershipRevision !== revision || tx.session.membershipRevision !== revision)
          throw new RoomError('stale_membership', 409);
        if (action === 'activate') {
          if (tx.session.state !== 'preparing') throw new RoomError('invalid_transition', 409);
          if (await tx.cleanupPending()) throw new RoomError('cleanup_pending', 409);
          await tx.updateSession('active');
          await tx.updateRoom({ state: 'active' });
        } else {
          await retire(tx);
          await tx.updateRoom({ state: (await tx.cleanupPending()) ? 'closing' : 'idle' });
        }
        await tx.audit(actor, `session_${action}`);
        return snapshot(tx, actor);
      });
    },
    async grant(
      actor: string,
      roomId: string,
      sessionId: string,
      epoch: number,
      role: ProductMediaGrant['role'],
      includeAudio = false,
    ) {
      return store.locked(roomId, async (tx) => {
        approved(tx, actor);
        const session = tx.session;
        if (
          !session ||
          session.id !== sessionId ||
          session.state !== 'active' ||
          tx.room.state !== 'active'
        )
          throw new RoomError('session_unavailable', 409);
        requireCurrentEpoch(tx.room.epoch, epoch);
        if (
          session.membershipRevision !== tx.room.membershipRevision ||
          (await tx.cleanupPending())
        )
          throw new RoomError('session_unavailable', 409);
        if ((role === 'publisher') !== (actor === session.publisherId))
          throw new RoomError('forbidden', 403);
        if (includeAudio && role !== 'publisher') throw new RoomError('forbidden', 403);
        const expiresAt = Math.floor(deps.now() / 1000) + 60;
        const accessToken = await deps.rtc.token({
          rtcRoom: session.rtcRoom,
          participantId: actor,
          role,
          expiresAt,
          includeAudio,
        });
        await tx.audit(actor, 'grant_issued');
        return {
          grant: {
            version: 1 as const,
            sessionId: session.id,
            epoch,
            rtcRoom: session.rtcRoom,
            participantId: actor,
            publisherId: session.publisherId,
            role,
            serverUrl: deps.serverUrl,
            accessToken,
            expiresAt,
          },
        };
      });
    },
  };
}

export type RoomService = ReturnType<typeof createRoomService>;
