import { expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  productGrantResponseSchema,
  roomListSchema,
  roomSnapshotSchema,
} from '@screen-share/contracts';
import { TokenVerifier } from 'livekit-server-sdk';
import {
  account,
  app,
  config,
  createRoom,
  database,
  headers,
  invite,
  request,
  store,
} from './product-support';

it('authenticates with real password sessions and rejects anonymous, IDOR, CSRF, oversized, and malformed requests', async () => {
  const owner = await account();
  const outsider = await account();
  const room = await createRoom(owner.cookie);
  expect((await request('/v1/rooms')).status).toBe(401);
  expect((await request(`/v1/rooms/${room.room.id}`, 'GET', outsider.cookie)).status).toBe(404);
  expect((await request('/v1/rooms', 'GET', outsider.cookie)).status).toBe(200);
  expect((await request('/v1/rooms/not-a-uuid', 'GET', owner.cookie)).status).toBe(400);
  expect((await request('/v1/rooms', 'POST', owner.cookie, { name: '' })).status).toBe(400);
  const missing = await request(`/v1/rooms/${randomUUID()}`, 'GET', owner.cookie);
  expect(missing.status).toBe(404);
  const session = await request('/api/auth/get-session', 'GET', owner.cookie);
  const sessionBody = await session.json();
  expect(sessionBody).not.toHaveProperty('session');
  expect(sessionBody).not.toHaveProperty('token');
  const csrf = await app.request('http://127.0.0.1:3000/v1/rooms', {
    method: 'POST',
    headers: { ...headers, origin: 'https://attacker.example', cookie: owner.cookie },
    body: '{"name":"Bad"}',
  });
  expect(csrf.status).toBe(403);
  const authCsrf = await app.request('http://127.0.0.1:3000/api/auth/sign-out', {
    method: 'POST',
    headers: { ...headers, origin: 'https://attacker.example', cookie: owner.cookie },
    body: '{}',
  });
  expect(authCsrf.status).toBe(403);
  const huge = await request('/v1/rooms', 'POST', owner.cookie, { name: 'x'.repeat(17000) });
  expect(huge.status).toBe(413);
  const logout = await request('/api/auth/sign-out', 'POST', owner.cookie, {});
  expect(logout.status).toBe(200);
  expect((await request('/v1/rooms', 'GET', owner.cookie)).status).toBe(401);
  const login = await request('/api/auth/sign-in/email', 'POST', '', {
    email: 'member-1@example.test',
    password: 'Synthetic-password-1234',
  });
  expect(login.status).toBe(200);
  expect(await login.json()).not.toHaveProperty('token');
});

it('serializes invitation use/capacity, requires owner approval, and denies revoked or expired invitations', async () => {
  const owner = await account();
  const viewer = await account();
  const other = await account();
  const room = await createRoom(owner.cookie);
  const oneUse = await invite(owner.cookie, room.room.id);
  const joins = await Promise.all(
    [viewer, other].map((member) =>
      request('/v1/invites/accept', 'POST', member.cookie, { token: oneUse.token }),
    ),
  );
  expect(joins.map((response) => response.status).sort()).toEqual([201, 404]);
  const accepted = joins[0]?.status === 201 ? viewer : other;
  const pendingResponse = await request(`/v1/rooms/${room.room.id}`, 'GET', accepted.cookie);
  expect(pendingResponse.status).toBe(200);
  const pendingSnapshot = roomSnapshotSchema.parse(await pendingResponse.json());
  expect(pendingSnapshot.room.membership).toBe('pending');
  expect(pendingSnapshot.members.map((member) => member.userId)).toEqual([accepted.id]);
  expect(pendingSnapshot.session).toBeNull();
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/members/${accepted.id}/approve`,
        'POST',
        accepted.cookie,
        {},
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/members/${accepted.id}/approve`,
        'POST',
        owner.cookie,
        {},
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/members/${accepted.id}/approve`,
        'POST',
        owner.cookie,
        {},
      )
    ).status,
  ).toBe(200);
  expect((await request(`/v1/rooms/${room.room.id}`, 'GET', accepted.cookie)).status).toBe(200);
  expect(
    (
      await request(`/v1/rooms/${room.room.id}/invites`, 'POST', accepted.cookie, {
        maxUses: 1,
        expiresInMinutes: 5,
      })
    ).status,
  ).toBe(403);
  const approvedList = roomListSchema.parse(
    await (await request('/v1/rooms', 'GET', owner.cookie)).json(),
  );
  expect(approvedList.rooms.find((entry) => entry.id === room.room.id)?.state).toBe('idle');
  const metadata = await request(`/v1/rooms/${room.room.id}/invites`, 'GET', owner.cookie);
  expect(metadata.status).toBe(200);
  const metadataBody = await metadata.json();
  expect(JSON.stringify(metadataBody)).not.toContain(oneUse.token);
  expect(JSON.stringify(metadataBody)).not.toContain('tokenHash');
  expect((await request(`/v1/rooms/${room.room.id}/invites`, 'GET', accepted.cookie)).status).toBe(
    403,
  );
  const revoked = await invite(owner.cookie, room.room.id);
  expect(
    (await request(`/v1/rooms/${room.room.id}/invites/${revoked.id}`, 'DELETE', owner.cookie))
      .status,
  ).toBe(200);
  expect(
    (await request('/v1/invites/accept', 'POST', viewer.cookie, { token: revoked.token })).status,
  ).toBe(404);
  const expired = await invite(owner.cookie, room.room.id);
  await database.pool.query(
    "UPDATE room_invites SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  expect(
    (await request('/v1/invites/accept', 'POST', other.cookie, { token: expired.token })).status,
  ).toBe(404);
  expect(
    (await request('/v1/invites/accept', 'POST', other.cookie, { token: 'a'.repeat(43) })).status,
  ).toBe(404);
  expect(
    (await request(`/v1/rooms/${room.room.id}/members/${owner.id}`, 'DELETE', owner.cookie)).status,
  ).toBe(409);
  expect(
    (await request(`/v1/rooms/${room.room.id}/members/${randomUUID()}`, 'DELETE', owner.cookie))
      .status,
  ).toBe(404);
  const hashes = await database.pool.query<{ token_hash: string }>(
    'SELECT token_hash FROM room_invites WHERE room_id=$1',
    [room.room.id],
  );
  expect(
    hashes.rows.every(
      (value) => value.token_hash.length === 64 && value.token_hash !== oneUse.token,
    ),
  ).toBe(true);
});

it('issues least-privilege real JWTs only for current approved epochs and reliably retires revoked sessions', async () => {
  const owner = await account();
  const viewer = await account();
  const room = await createRoom(owner.cookie);
  const join = await invite(owner.cookie, room.room.id);
  expect(
    (await request('/v1/invites/accept', 'POST', viewer.cookie, { token: join.token })).status,
  ).toBe(201);
  await request(`/v1/rooms/${room.room.id}/members/${viewer.id}/approve`, 'POST', owner.cookie, {});
  const prepare = await request(`/v1/rooms/${room.room.id}/sessions`, 'POST', owner.cookie, {});
  let snapshot = roomSnapshotSchema.parse(await prepare.json());
  if (!snapshot.session) throw new Error('Expected a preparing session');
  const transition = {
    epoch: snapshot.session.epoch,
    membershipRevision: snapshot.room.membershipRevision,
  };
  const grantRequest = {
    sessionId: snapshot.session.id,
    epoch: snapshot.session.epoch,
    role: 'viewer',
  };
  expect(
    (await request(`/v1/rooms/${room.room.id}/grants`, 'POST', viewer.cookie, grantRequest)).status,
  ).toBe(409);
  const active = await request(
    `/v1/rooms/${room.room.id}/sessions/${snapshot.session.id}/activate`,
    'POST',
    owner.cookie,
    transition,
  );
  expect(active.status).toBe(200);
  for (const [member, role] of [
    [owner, 'publisher'],
    [viewer, 'viewer'],
  ] as const) {
    const response = await request(`/v1/rooms/${room.room.id}/grants`, 'POST', member.cookie, {
      ...grantRequest,
      role,
    });
    expect(response.status).toBe(200);
    const value = productGrantResponseSchema.parse(await response.json());
    const claims = await new TokenVerifier(
      config.LIVEKIT_API_KEY,
      config.LIVEKIT_API_SECRET,
    ).verify(value.grant.accessToken);
    expect(claims.video?.canPublish).toBe(role === 'publisher');
    expect(claims.video?.canSubscribe).toBe(role === 'viewer');
    expect(claims.video?.canPublishData).toBe(false);
    expect(value.grant.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(60);
    expect(value.grant.publisherId).toBe(owner.id);
  }
  expect(
    (
      await request(`/v1/rooms/${room.room.id}/grants`, 'POST', viewer.cookie, {
        ...grantRequest,
        role: 'publisher',
      })
    ).status,
  ).toBe(403);
  const audioResponse = await request(`/v1/rooms/${room.room.id}/grants`, 'POST', owner.cookie, {
    ...grantRequest,
    role: 'publisher',
    includeAudio: true,
  });
  expect(audioResponse.status).toBe(200);
  const audioGrant = productGrantResponseSchema.parse(await audioResponse.json());
  const audioClaims = await new TokenVerifier(
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
  ).verify(audioGrant.grant.accessToken);
  expect(JSON.stringify(audioClaims.video?.canPublishSources)).toBe(
    '["screen_share","screen_share_audio"]',
  );
  expect(
    (
      await request(`/v1/rooms/${room.room.id}/grants`, 'POST', viewer.cookie, {
        ...grantRequest,
        includeAudio: true,
      })
    ).status,
  ).toBe(403);
  const revoke = await request(
    `/v1/rooms/${room.room.id}/members/${viewer.id}`,
    'DELETE',
    owner.cookie,
  );
  expect(revoke.status).toBe(200);
  snapshot = roomSnapshotSchema.parse(await revoke.json());
  expect(snapshot.cleanupPending).toBe(true);
  expect(
    (await request(`/v1/rooms/${room.room.id}/grants`, 'POST', viewer.cookie, grantRequest)).status,
  ).toBe(404);
  const replacement = await request(`/v1/rooms/${room.room.id}/sessions`, 'POST', owner.cookie, {});
  const candidate = roomSnapshotSchema.parse(await replacement.json());
  if (!candidate.session) throw new Error('Expected a new session');
  expect(candidate.session.epoch).toBeGreaterThan(transition.epoch);
  const activation = {
    epoch: candidate.session.epoch,
    membershipRevision: candidate.room.membershipRevision,
  };
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/sessions/${candidate.session.id}/activate`,
        'POST',
        owner.cookie,
        activation,
      )
    ).status,
  ).toBe(409);
  await store.processCleanup(async () => {
    throw new Error('Synthetic RTC outage');
  });
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/sessions/${candidate.session.id}/activate`,
        'POST',
        owner.cookie,
        activation,
      )
    ).status,
  ).toBe(409);
  await database.pool.query(
    "UPDATE rtc_cleanup_outbox SET available_at=now()-interval '1 second' WHERE room_id=$1",
    [room.room.id],
  );
  const removed: string[] = [];
  await store.processCleanup(async (rtcRoom) => {
    removed.push(rtcRoom);
  });
  expect(removed).toHaveLength(1);
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/sessions/${candidate.session.id}/activate`,
        'POST',
        owner.cookie,
        activation,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/v1/rooms/${room.room.id}/grants`, 'POST', owner.cookie, {
        ...grantRequest,
        role: 'publisher',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/sessions/${candidate.session.id}/close`,
        'POST',
        owner.cookie,
        activation,
      )
    ).status,
  ).toBe(200);
  await store.processCleanup(async () => {});
  const list = roomListSchema.parse(await (await request('/v1/rooms', 'GET', owner.cookie)).json());
  expect(list.rooms.find((entry) => entry.id === room.room.id)?.state).toBe('idle');

  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/sessions/${candidate.session.id}/activate`,
        'POST',
        owner.cookie,
        activation,
      )
    ).status,
  ).toBe(409);
});

it('keeps the public catalog available when product authentication is mounted', async () => {
  expect((await request('/v1/video-profiles')).status).toBe(200);
  expect((await request('/v1/rooms')).status).toBe(401);
});
