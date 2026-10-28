import { expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { roomSnapshotSchema } from '@screen-share/contracts';
import { account, createRoom, database, invite, request, store } from './product-support';

it('limits pending plus approved membership to eight even during concurrent joins', async () => {
  const owner = await account();
  const viewers = [];
  for (let i = 0; i < 8; i++) viewers.push(await account());
  const room = await createRoom(owner.cookie);
  const firstInvite = await invite(owner.cookie, room.room.id, 7);
  const responses = await Promise.all(
    viewers
      .slice(0, 7)
      .map((member) =>
        request('/v1/invites/accept', 'POST', member.cookie, { token: firstInvite.token }),
      ),
  );
  expect(responses.every((response) => response.status === 201)).toBe(true);
  const nextInvite = await invite(owner.cookie, room.room.id);
  const extra = viewers[7];
  if (!extra) throw new Error('Expected a ninth room participant');
  expect(
    (await request('/v1/invites/accept', 'POST', extra.cookie, { token: nextInvite.token })).status,
  ).toBe(409);
  const count = await database.pool.query<{ count: string }>(
    'SELECT count(*) FROM room_members WHERE room_id=$1',
    [room.room.id],
  );
  expect(count.rows[0]?.count).toBe('8');
  const first = viewers[0];
  if (!first) throw new Error('Expected an invited participant');
  expect(
    (await request('/v1/invites/accept', 'POST', first.cookie, { token: nextInvite.token })).status,
  ).toBe(409);
});

it('atomically consumes rate limits across concurrent requests and returns a retry deadline', async () => {
  const key = `atomic-test-${randomUUID()}`;
  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.consumeLimit(key, 60, 3)),
  );
  expect(results.filter((result) => result.allowed)).toHaveLength(3);
  expect(results.filter((result) => !result.allowed)).toHaveLength(7);
  const owner = await account();
  const bucket = Math.floor(Date.now() / 60000) * 60;
  const opaque = createHash('sha256').update(`product:${owner.id}`).digest('hex');
  await database.pool.query(
    'INSERT INTO request_limits(key,count,window_start) VALUES($1,120,$2)',
    [opaque, bucket],
  );
  const response = await request('/v1/rooms', 'GET', owner.cookie);
  expect(response.status).toBe(429);
  expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(await response.json()).toEqual({ error: 'rate_limited' });
});

it('enforces persistent authentication throttling without trusting user-supplied account identity', async () => {
  let last: Response | undefined;
  // A real minute boundary can divide two ten-request buckets. The suite's
  // fifteen-second deadline bounds this to at most one boundary.
  for (let i = 0; i < 21; i++) {
    last = await request('/api/auth/sign-in/email', 'POST', '', {
      email: 'missing@example.test',
      password: 'Synthetic-password-1234',
    });
    if (last.status === 429) break;
    expect(last.status).toBe(401);
  }
  expect(last?.status).toBe(429);
});

it('abandons candidates on roster change and serializes concurrent session epochs', async () => {
  const owner = await account();
  const viewer = await account();
  const room = await createRoom(owner.cookie);
  const invitation = await invite(owner.cookie, room.room.id);
  await request('/v1/invites/accept', 'POST', viewer.cookie, { token: invitation.token });
  await request(`/v1/rooms/${room.room.id}/members/${viewer.id}/approve`, 'POST', owner.cookie, {});
  const first = roomSnapshotSchema.parse(
    await (await request(`/v1/rooms/${room.room.id}/sessions`, 'POST', owner.cookie, {})).json(),
  );
  if (!first.session) throw new Error('Expected a candidate');
  const removal = await request(
    `/v1/rooms/${room.room.id}/members/${viewer.id}`,
    'DELETE',
    owner.cookie,
  );
  const revoked = roomSnapshotSchema.parse(await removal.json());
  expect(revoked.session?.state).toBe('abandoned');
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/sessions/${first.session.id}/activate`,
        'POST',
        owner.cookie,
        { epoch: first.session.epoch, membershipRevision: first.room.membershipRevision },
      )
    ).status,
  ).toBe(409);
  await store.processCleanup(async () => {});
  const concurrent = await Promise.all(
    [1, 2].map(() => request(`/v1/rooms/${room.room.id}/sessions`, 'POST', owner.cookie, {})),
  );
  expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
  const snapshots = await Promise.all(
    concurrent
      .filter((response) => response.status === 201)
      .map(async (response) => roomSnapshotSchema.parse(await response.json())),
  );
  const epochs = snapshots.map((snapshot) => snapshot.session?.epoch).sort();
  expect(epochs).toEqual([first.session.epoch + 1]);
  const latest = roomSnapshotSchema.parse(
    await (await request(`/v1/rooms/${room.room.id}`, 'GET', owner.cookie)).json(),
  );
  if (!latest.session) throw new Error('Expected the latest serialized candidate');
  await store.processCleanup(async () => {});
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/sessions/${latest.session.id}/activate`,
        'POST',
        owner.cookie,
        { epoch: latest.session.epoch, membershipRevision: latest.room.membershipRevision },
      )
    ).status,
  ).toBe(200);
  const names = await database.pool.query<{ rtc_room: string }>(
    'SELECT rtc_room FROM media_sessions WHERE room_id=$1',
    [room.room.id],
  );
  expect(new Set(names.rows.map((entry) => entry.rtc_room)).size).toBe(2);
  expect(await store.processCleanup(async () => {})).toBe(0);
});

it('bounds owner room creation transactionally and prevents candidate cleanup amplification', async () => {
  const owner = await account();
  for (let i = 0; i < 19; i++) await store.create(randomUUID(), `Synthetic room ${i}`, owner.id);
  const attempts = await Promise.all(
    [1, 2].map(() => request('/v1/rooms', 'POST', owner.cookie, { name: 'Last permitted room' })),
  );
  expect(attempts.map((response) => response.status).sort()).toEqual([201, 409]);
  const created = attempts.find((response) => response.status === 201);
  if (!created) throw new Error('Expected exactly one final owner slot');
  const snapshot = roomSnapshotSchema.parse(await created.json());
  expect(
    (await request(`/v1/rooms/${snapshot.room.id}/sessions`, 'POST', owner.cookie, {})).status,
  ).toBe(201);
  for (let i = 0; i < 4; i++)
    expect(
      (await request(`/v1/rooms/${snapshot.room.id}/sessions`, 'POST', owner.cookie, {})).status,
    ).toBe(409);
  const pending = await database.pool.query<{ count: string }>(
    'SELECT count(*) FROM rtc_cleanup_outbox WHERE room_id=$1 AND completed_at IS NULL',
    [snapshot.room.id],
  );
  expect(pending.rows[0]?.count).toBe('0');
});
