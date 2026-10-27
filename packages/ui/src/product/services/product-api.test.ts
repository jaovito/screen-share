import { afterEach, expect, it, spyOn } from 'bun:test';
import { grant, inviteId, owner, ProductServer, roomId, viewerId } from '../fixtures.test';
import { createProductApi, ProductApiError } from './product-api';

const signal = () => new AbortController().signal;
afterEach(() => {
  spyOn(globalThis, 'fetch').mockRestore();
});

it('validates every product control response and sends bounded role and epoch inputs', async () => {
  const server = new ProductServer();
  const api = createProductApi('https://control.example.test/', server.control);
  expect(await api.session(signal())).toEqual(owner);
  await api.authenticate(
    false,
    { email: owner.email, password: 'synthetic-password', name: '' },
    signal(),
  );
  await api.authenticate(
    true,
    { email: owner.email, password: 'synthetic-password', name: owner.name },
    signal(),
  );
  expect(await api.rooms(signal())).toHaveLength(1);
  const initial = await api.room(roomId, signal());
  await expect(
    Promise.resolve().then(() => api.transition(initial, 'activate', signal())),
  ).rejects.toThrow('current media session');
  await expect(
    Promise.resolve().then(() => api.grant(initial, 'viewer', signal())),
  ).rejects.toThrow('current media session');
  expect((await api.createRoom('Friday games', signal())).room.id).toBe(roomId);
  expect(await api.invites(roomId, signal())).toEqual([]);
  const invitation = await api.createInvite(roomId, 30, 1, signal());
  expect(invitation.id).toBe(inviteId);
  expect((await api.acceptInvite(invitation.token, signal())).status).toBe('pending');
  await api.revokeInvite(roomId, inviteId, signal());
  expect((await api.member(roomId, viewerId, true, signal())).members[1]?.status).toBe('approved');
  expect((await api.member(roomId, viewerId, false, signal())).members).toHaveLength(1);
  const prepared = await api.prepare(roomId, signal());
  const active = await api.transition(prepared, 'activate', signal());
  expect((await api.grant(active, 'publisher', signal())).sessionId).toBe(grant().sessionId);
  await api.transition(active, 'close', signal());
  await api.signOut(signal());
  expect(await api.session(signal())).toBeNull();
  expect(server.calls.find((call) => call.path.endsWith('/grants'))?.body).toEqual({
    role: 'publisher',
    sessionId: grant().sessionId,
    epoch: 1,
    includeAudio: false,
  });
});

it('uses credentialed browser requests and rejects unsafe URLs, failed responses and malformed DTOs', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ user: owner }));
  const api = createProductApi('http://127.0.0.1:3000');
  expect(await api.session(signal())).toEqual(owner);
  expect(fetch.mock.calls[0]?.[1]?.credentials).toBe('include');
  fetch.mockResolvedValue(Response.json({}, { status: 401 }));
  await expect(api.session(signal())).rejects.toBeInstanceOf(ProductApiError);
  fetch.mockResolvedValue(Response.json({ user: { id: 'untrusted' } }));
  await expect(api.session(signal())).rejects.toThrow();
  for (const url of [
    'http://remote.example.test',
    'https://user:secret@example.test',
    'https://example.test/?token=x',
    'https://example.test/#secret',
  ]) {
    expect(() => createProductApi(url)).toThrow();
  }
  const bad = createProductApi('https://example.test', async () => ({ status: 403, body: {} }));
  await expect(bad.rooms(signal())).rejects.toBeInstanceOf(ProductApiError);
  const controller = new AbortController();
  controller.abort();
  const aborted = createProductApi('https://example.test', async () => ({
    status: 200,
    body: null,
  }));
  await expect(aborted.session(controller.signal)).rejects.toThrow('aborted');
});
