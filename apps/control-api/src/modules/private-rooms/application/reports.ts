import type { ReceiverReport } from '@screen-share/contracts';
import { RoomError, requireCurrentEpoch, requireOwner } from '../domain/policy';
import type { RoomStore, RoomTransaction } from './ports';
import type { ReportCache } from './report-port';

export function createRoomReports(store: RoomStore, cache: ReportCache) {
  function authorize(tx: RoomTransaction, actor: string) {
    const member = tx.members.find((entry) => entry.userId === actor);
    if (member?.status !== 'approved') throw new RoomError('not_found', 404);
    const session = tx.session;
    if (
      session?.state !== 'active' ||
      tx.room.state !== 'active' ||
      session.epoch !== tx.room.epoch ||
      session.membershipRevision !== tx.room.membershipRevision
    )
      throw new RoomError('session_unavailable', 409);
    return session;
  }
  return {
    submit(actor: string, roomId: string, report: ReceiverReport) {
      return store.locked(roomId, async (tx) => {
        const session = authorize(tx, actor);
        if (
          actor === session.publisherId ||
          tx.members.find((entry) => entry.userId === actor)?.role !== 'viewer'
        )
          throw new RoomError('forbidden', 403);
        if (session.id !== report.sessionId) throw new RoomError('stale_session', 409);
        requireCurrentEpoch(session.epoch, report.epoch);
        if (await tx.cleanupPending()) throw new RoomError('session_unavailable', 409);
        if (!cache.put(roomId, actor, report)) throw new RoomError('stale_report', 409);
        return { accepted: true as const };
      });
    },
    list(actor: string, roomId: string) {
      return store.locked(roomId, async (tx) => {
        const session = authorize(tx, actor);
        requireOwner(tx.room.ownerId, actor);
        if (await tx.cleanupPending()) throw new RoomError('session_unavailable', 409);
        const allowed = new Set(
          tx.members
            .filter((entry) => entry.status === 'approved' && entry.userId !== session.publisherId)
            .map((entry) => entry.userId),
        );
        return {
          sessionId: session.id,
          epoch: session.epoch,
          reports: cache
            .list(roomId, session.id, session.epoch)
            .filter((entry) => allowed.has(entry.userId)),
        };
      });
    },
  };
}
export type RoomReports = ReturnType<typeof createRoomReports>;
