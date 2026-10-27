import { randomUUID } from 'node:crypto';
import {
  inviteCreatedSchema,
  productGrantResponseSchema,
  productUserSchema,
  roomSnapshotSchema,
} from '@screen-share/contracts';
import { z } from 'zod';

/** Own synthetic accounts/room; content keys are deliberately absent from this API path. */
export async function issueProductGrants() {
  const base = process.env.MEDIA_PROOF_CONTROL_URL;
  const origin = `http://127.0.0.1:${process.env.MEDIA_PROOF_VIEWER_PORT}`;
  if (!base || process.env.INTEGRATION_DATABASE !== 'disposable')
    throw new Error('Owned product infrastructure required.');

  async function call(path: string, cookie: string, body?: object) {
    const response = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Synthetic product setup failed (${response.status}).`);
    return response;
  }

  async function account() {
    const response = await call('/api/auth/sign-up/email', '', {
      email: `${randomUUID()}@example.test`,
      name: 'Synthetic media participant',
      password: `Synthetic-${randomUUID()}`,
    });
    const user = z.object({ user: productUserSchema }).parse(await response.json()).user;
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    if (!cookie) throw new Error('Synthetic cookie session unavailable.');
    return { id: user.id, cookie };
  }
  const [publisher, viewer, wrong] = [await account(), await account(), await account()];
  let snapshot = roomSnapshotSchema.parse(
    await (
      await call('/v1/rooms', publisher.cookie, { name: 'Synthetic media interoperability' })
    ).json(),
  );
  const room = `/v1/rooms/${snapshot.room.id}`;
  const invite = inviteCreatedSchema.parse(
    await (
      await call(`${room}/invites`, publisher.cookie, { expiresInMinutes: 5, maxUses: 2 })
    ).json(),
  );
  for (const member of [viewer, wrong]) {
    await call('/v1/invites/accept', member.cookie, { token: invite.token });
    await call(`${room}/members/${member.id}/approve`, publisher.cookie, {});
  }
  snapshot = roomSnapshotSchema.parse(
    await (await call(`${room}/sessions`, publisher.cookie, {})).json(),
  );
  const session = snapshot.session;
  if (!session) throw new Error('Synthetic media session unavailable.');
  snapshot = roomSnapshotSchema.parse(
    await (
      await call(`${room}/sessions/${session.id}/activate`, publisher.cookie, {
        epoch: session.epoch,
        membershipRevision: session.membershipRevision,
      })
    ).json(),
  );
  const grants = [];
  for (const member of [publisher, viewer, wrong]) {
    grants.push(
      productGrantResponseSchema.parse(
        await (
          await call(`${room}/grants`, member.cookie, {
            role: member.id === publisher.id ? 'publisher' : 'viewer',
            includeAudio: member.id === publisher.id,
            sessionId: session.id,
            epoch: session.epoch,
          })
        ).json(),
      ).grant,
    );
  }
  return {
    grants,
    async renewPublisher() {
      return productGrantResponseSchema.parse(
        await (
          await call(`${room}/grants`, publisher.cookie, {
            role: 'publisher',
            includeAudio: true,
            sessionId: session.id,
            epoch: session.epoch,
          })
        ).json(),
      ).grant;
    },
  };
}
