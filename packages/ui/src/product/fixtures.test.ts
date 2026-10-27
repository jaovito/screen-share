import type { ProductMediaGrant, ProductUser, RoomSnapshot } from '@screen-share/contracts';
import type { NativeSharingStatus, ProductControlTransport } from './types';

export const ownerId = '11111111-1111-4111-8111-111111111111';
export const viewerId = '22222222-2222-4222-8222-222222222222';
export const roomId = '33333333-3333-4333-8333-333333333333';
export const sessionId = '44444444-4444-4444-8444-444444444444';
export const inviteId = '55555555-5555-4555-8555-555555555555';
export const owner: ProductUser = { id: ownerId, name: 'Owner', email: 'owner@example.test' };
export const viewer: ProductUser = { id: viewerId, name: 'Viewer', email: 'viewer@example.test' };

export function snapshot(): RoomSnapshot {
  return {
    room: {
      id: roomId,
      name: 'Friday games',
      ownerId,
      epoch: 1,
      membershipRevision: 1,
      membership: 'owner',
      state: 'idle',
      createdAt: '2026-10-27T00:00:00.000Z',
    },
    members: [
      { userId: ownerId, name: owner.name, status: 'approved', role: 'owner' },
      { userId: viewerId, name: viewer.name, status: 'pending', role: 'viewer' },
    ],
    session: null,
    cleanupPending: false,
  };
}

export function grant(role: 'publisher' | 'viewer' = 'publisher'): ProductMediaGrant {
  return {
    version: 1,
    sessionId,
    epoch: 1,
    rtcRoom: `ss-${roomId}`,
    participantId: role === 'publisher' ? ownerId : viewerId,
    publisherId: ownerId,
    role,
    serverUrl: 'ws://127.0.0.1:7880',
    accessToken: 'synthetic-test-token-not-usable',
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
}

export function sharingStatus(state: NativeSharingStatus['state'] = 'idle'): NativeSharingStatus {
  return {
    state,
    profileId: '1080p60',
    elapsedMs: 1000,
    framesCaptured: 30,
    framesEncoded: 29,
    encodedBytes: 3000,
    queueReplacements: 1,
    captureFps: 30,
    encodedFps: 29,
    targetFps: 60,
    reason: null,
    encryption: 'configured',
    audioSupported: false,
  };
}

export class ProductServer {
  user: ProductUser | null = owner;
  current = snapshot();
  hasRoom = true;
  fail = false;
  calls: { path: string; method: string; body?: object }[] = [];

  control: ProductControlTransport = async ({ path, method, body }) => {
    this.calls.push({ path, method, ...(body ? { body } : {}) });
    if (this.fail) throw new Error('Synthetic network failure');
    if (path.endsWith('/get-session'))
      return { status: 200, body: this.user ? { user: this.user } : null };
    if (path.includes('/sign-in/') || path.includes('/sign-up/')) {
      this.user = owner;
      return { status: 200, body: {} };
    }
    if (path.endsWith('/sign-out')) {
      this.user = null;
      return { status: 200, body: {} };
    }
    if (!this.user) return { status: 401, body: { error: 'unauthorized' } };
    if (path === '/v1/rooms' && method === 'GET')
      return { status: 200, body: { rooms: this.hasRoom ? [this.current.room] : [] } };
    if (path === '/v1/rooms' && method === 'POST') {
      this.hasRoom = true;
      return { status: 200, body: this.current };
    }
    if (path === `/v1/rooms/${roomId}`) return { status: 200, body: this.current };
    if (path === '/v1/invites/accept') return { status: 200, body: { roomId, status: 'pending' } };
    if (path.endsWith('/invites') && method === 'GET')
      return { status: 200, body: { invites: [] } };
    if (path.endsWith('/invites'))
      return {
        status: 200,
        body: {
          id: inviteId,
          token: 'b'.repeat(43),
          expiresAt: '2026-10-28T00:00:00.000Z',
          maxUses: 1,
        },
      };
    if (path.includes('/invites/')) return { status: 200, body: { ok: true } };
    if (path.includes('/members/')) {
      this.current.members = this.current.members.filter(
        (member) => member.userId !== viewerId || method === 'POST',
      );
      this.current.members = this.current.members.map((member) => ({
        ...member,
        status: 'approved',
      }));
      return { status: 200, body: this.current };
    }
    if (path.endsWith('/sessions')) {
      this.current.room.epoch = 1;
      this.current.room.state = 'preparing';
      this.current.session = {
        id: sessionId,
        epoch: 1,
        membershipRevision: 1,
        publisherId: ownerId,
        state: 'preparing',
        createdAt: '2026-10-27T00:00:00.000Z',
      };
      return { status: 200, body: this.current };
    }
    if (path.endsWith('/activate') || path.endsWith('/close')) {
      const state = path.endsWith('/activate') ? 'active' : 'closed';
      this.current.room.state = state;
      if (this.current.session) this.current.session.state = state;
      return { status: 200, body: this.current };
    }
    if (path.endsWith('/grants')) {
      const role = body && 'role' in body && body.role === 'viewer' ? 'viewer' : 'publisher';
      return { status: 200, body: { grant: grant(role) } };
    }
    return { status: 404, body: { error: 'not_found' } };
  };
}
