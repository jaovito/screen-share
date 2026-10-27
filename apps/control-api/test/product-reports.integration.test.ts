import { expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  peerReportsSchema,
  type ReceiverReport,
  roomSnapshotSchema,
} from '@screen-share/contracts';
import { account, createRoom, invite, request } from './product-support';

it('accepts only current approved viewers and exposes ephemeral metrics only to the room owner', async () => {
  const owner = await account();
  const viewer = await account();
  const outsider = await account();
  let room = await createRoom(owner.cookie);
  const invitation = await invite(owner.cookie, room.room.id);
  expect(
    (await request('/v1/invites/accept', 'POST', viewer.cookie, { token: invitation.token }))
      .status,
  ).toBe(201);
  const path = `/v1/rooms/${room.room.id}/reports`;
  const metrics = {
    intervalMs: 1000,
    decodedFps: 30,
    inboundBitrateBps: 1_000_000,
    droppedFrames: 0,
    averageDecodeMs: 4,
    packetLossRatio: 0,
    jitterMs: 2,
    transportRttMs: 20,
    width: 1280,
    height: 720,
  };
  const input: ReceiverReport = {
    sessionId: randomUUID(),
    epoch: 1,
    reportId: randomUUID(),
    sequence: 1,
    metrics,
  };
  expect((await request(path, 'POST', '', input)).status).toBe(401);
  expect((await request(path, 'GET', viewer.cookie)).status).toBe(404);
  expect((await request(path, 'POST', viewer.cookie, input)).status).toBe(404);
  expect((await request(path, 'GET', outsider.cookie)).status).toBe(404);
  expect((await request(path, 'GET', owner.cookie)).status).toBe(409);
  room = roomSnapshotSchema.parse(
    await (
      await request(
        `/v1/rooms/${room.room.id}/members/${viewer.id}/approve`,
        'POST',
        owner.cookie,
        {},
      )
    ).json(),
  );
  room = roomSnapshotSchema.parse(
    await (await request(`/v1/rooms/${room.room.id}/sessions`, 'POST', owner.cookie, {})).json(),
  );
  if (!room.session) throw new Error('Expected prepared session');
  const session = room.session;
  expect((await request(path, 'POST', viewer.cookie, input)).status).toBe(409);
  expect(
    (
      await request(
        `/v1/rooms/${room.room.id}/sessions/${session.id}/activate`,
        'POST',
        owner.cookie,
        { epoch: session.epoch, membershipRevision: session.membershipRevision },
      )
    ).status,
  ).toBe(200);
  input.sessionId = session.id;
  input.epoch = session.epoch;
  expect((await request(path, 'POST', owner.cookie, input)).status).toBe(403);
  expect((await request(path, 'GET', viewer.cookie)).status).toBe(403);
  expect((await request(path, 'POST', viewer.cookie, { ...input, epoch: 99 })).status).toBe(409);
  expect((await request(path, 'POST', viewer.cookie, { ...input, userId: owner.id })).status).toBe(
    400,
  );
  expect((await request(path, 'POST', viewer.cookie, input)).status).toBe(200);
  expect((await request(path, 'POST', viewer.cookie, input)).status).toBe(409);
  const listed = await request(path, 'GET', owner.cookie);
  expect(listed.headers.get('cache-control')).toBe('no-store');
  const reports = peerReportsSchema.parse(await listed.json());
  expect(reports.reports).toHaveLength(1);
  expect(reports.reports[0]?.userId).toBe(viewer.id);
  expect(reports.reports[0]?.receivedAt).toBeGreaterThan(Date.now() - 5000);
  expect(reports.reports[0]).not.toHaveProperty('accessToken');
  expect(
    (await request(`/v1/rooms/${room.room.id}/members/${viewer.id}`, 'DELETE', owner.cookie))
      .status,
  ).toBe(200);
  expect((await request(path, 'POST', viewer.cookie, { ...input, sequence: 2 })).status).toBe(404);
  expect((await request(path, 'GET', owner.cookie)).status).toBe(409);
});
