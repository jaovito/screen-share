import { randomBytes, randomUUID } from 'node:crypto';
import {
  productMediaGrantSchema,
  receiverReportSchema,
  requestProductGrantSchema,
  roomSnapshotSchema,
} from '@screen-share/contracts';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { z } from 'zod';

// Controlled metadata fixture only; real authentication/SQL is covered by product E2E.
// The content key never enters this fixture or its HTTP requests.
export function fixtureApi(serverUrl: string, apiKey: string, apiSecret: string) {
  const userId = randomUUID();
  const publisherId = randomUUID();
  const sessionId = randomUUID();
  const roomId = randomUUID();
  const cookie = randomBytes(24).toString('hex');
  const password = randomBytes(24).toString('base64url');
  const email = 'desktop-fixture@example.invalid';
  const user = { id: userId, name: 'Desktop receiver fixture', email };
  const snapshot = roomSnapshotSchema.parse({
    room: {
      id: roomId,
      name: 'Owned desktop receiver fixture',
      ownerId: publisherId,
      epoch: 1,
      membershipRevision: 1,
      membership: 'approved',
      state: 'active',
      createdAt: new Date().toISOString(),
    },
    members: [
      { userId: publisherId, name: 'Synthetic publisher', status: 'approved', role: 'owner' },
      { userId, name: user.name, status: 'approved', role: 'viewer' },
    ],
    session: {
      id: sessionId,
      epoch: 1,
      membershipRevision: 1,
      publisherId,
      state: 'active',
      createdAt: new Date().toISOString(),
    },
    cleanupPending: false,
  });
  let grants = 0;
  let reports = 0;
  let authenticatedRequests = 0;
  const json = (body: unknown, status = 200, headers?: HeadersInit) =>
    Response.json(body, { status, ...(headers ? { headers } : {}) });

  async function grant(role: 'publisher' | 'viewer') {
    const identity = role === 'publisher' ? publisherId : userId;
    const token = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 });
    token.addGrant({
      roomJoin: true,
      room: `ss-${sessionId}`,
      canPublish: role === 'publisher',
      canSubscribe: role === 'viewer',
      canPublishData: false,
      ...(role === 'publisher'
        ? { canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] }
        : {}),
    });
    return productMediaGrantSchema.parse({
      version: 1,
      sessionId,
      epoch: 1,
      rtcRoom: `ss-${sessionId}`,
      participantId: identity,
      publisherId,
      role,
      serverUrl,
      accessToken: await token.toJwt(),
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      try {
        const path = new URL(request.url).pathname;
        const signedIn = request.headers.get('cookie') === `desktop_fixture=${cookie}`;
        if (path === '/api/auth/sign-in/email' && request.method === 'POST') {
          const parsed = z
            .strictObject({ email: z.literal(email), password: z.literal(password) })
            .safeParse(await request.json());
          if (!parsed.success) return json({}, 401);
          return json({ user }, 200, {
            'Set-Cookie': `desktop_fixture=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
          });
        }
        if (path === '/api/auth/get-session') return json(signedIn ? { user } : null);
        if (!signedIn) return json({}, 401);
        authenticatedRequests++;
        if (path === '/api/auth/sign-out')
          return json({}, 200, {
            'Set-Cookie': 'desktop_fixture=; Max-Age=0; HttpOnly; Path=/',
          });
        if (request.method === 'GET' && path === '/v1/rooms')
          return json({ rooms: [snapshot.room] });
        if (request.method === 'GET' && path === `/v1/rooms/${roomId}`) return json(snapshot);
        if (request.method === 'POST' && path === `/v1/rooms/${roomId}/grants`) {
          const input = requestProductGrantSchema.parse(await request.json());
          if (input.role !== 'viewer' || input.sessionId !== sessionId || input.epoch !== 1)
            return json({}, 403);
          if (++grants > 12) return json({}, 429);
          return json({ grant: await grant('viewer') });
        }
        if (request.method === 'POST' && path === `/v1/rooms/${roomId}/reports`) {
          const input = receiverReportSchema.parse(await request.json());
          if (input.sessionId !== sessionId || input.epoch !== 1 || ++reports > 30)
            return json({}, 403);
          return json({ accepted: true });
        }
        return json({}, 404);
      } catch {
        return json({}, 400);
      }
    },
  });
  return {
    server,
    email,
    password,
    roomName: snapshot.room.name,
    apiUrl: `http://127.0.0.1:${server.port}`,
    publisherGrant: () => grant('publisher'),
    observed: () => ({ grants, reports, authenticatedRequests }),
  };
}
