export class RoomError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
  ) {
    super(code);
  }
}

export function requireOwner(ownerId: string, actorId: string) {
  if (ownerId !== actorId) throw new RoomError('forbidden', 403);
}

export function requireCapacity(count: number) {
  if (count >= 8) throw new RoomError('room_full', 409);
}

export function requireCurrentEpoch(current: number, requested: number) {
  if (current !== requested) throw new RoomError('stale_session', 409);
}
