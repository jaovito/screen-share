import {
  inviteAcceptedSchema,
  inviteCreatedSchema,
  peerReportsSchema,
  productGrantResponseSchema,
  productUserSchema,
  type ReceiverReport,
  type RoomSnapshot,
  receiverReportSchema,
  reportAcceptedSchema,
  roomInvitesResponseSchema,
  roomListSchema,
  roomSnapshotSchema,
} from '@screen-share/contracts';
import { z } from 'zod';
import type { ProductControlTransport } from '../types';

const sessionSchema = z.object({ user: productUserSchema }).nullable();
const emptySchema = z.object({});

export class ProductApiError extends Error {
  constructor(readonly status: number) {
    super('Product request failed');
  }
}

export function createProductApi(baseUrl: string, control?: ProductControlTransport) {
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  )
    throw new Error('A secure API URL or explicit loopback development URL is required');

  const base = baseUrl.replace(/\/$/, '');

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    body?: object,
    method = body ? 'POST' : 'GET',
  ): Promise<T> {
    if (control) {
      const response = await control({ path, method, signal, ...(body ? { body } : {}) });
      if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
      if (response.status < 200 || response.status >= 300)
        throw new ProductApiError(response.status);
      return schema.parse(response.body);
    }

    const response = await fetch(`${base}${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) throw new ProductApiError(response.status);

    return schema.parse(await response.json());
  }

  const roomPath = (id: string) => `/v1/rooms/${encodeURIComponent(id)}`;

  return {
    async report(id: string, input: ReceiverReport, signal: AbortSignal) {
      return request(
        `${roomPath(id)}/reports`,
        reportAcceptedSchema,
        signal,
        receiverReportSchema.parse(input),
      );
    },
    peerReports(id: string, signal: AbortSignal) {
      return request(`${roomPath(id)}/reports`, peerReportsSchema, signal);
    },
    async session(signal: AbortSignal) {
      return (await request('/api/auth/get-session', sessionSchema, signal))?.user ?? null;
    },
    async authenticate(
      signUp: boolean,
      credentials: { email: string; password: string; name: string },
      signal: AbortSignal,
    ) {
      await request(
        `/api/auth/${signUp ? 'sign-up' : 'sign-in'}/email`,
        emptySchema,
        signal,
        signUp ? credentials : { email: credentials.email, password: credentials.password },
      );
    },
    async signOut(signal: AbortSignal) {
      await request('/api/auth/sign-out', emptySchema, signal, {});
    },
    async rooms(signal: AbortSignal) {
      return (await request('/v1/rooms', roomListSchema, signal)).rooms;
    },
    room(id: string, signal: AbortSignal) {
      return request(roomPath(id), roomSnapshotSchema, signal);
    },
    createRoom(name: string, signal: AbortSignal) {
      return request('/v1/rooms', roomSnapshotSchema, signal, { name });
    },
    async invites(id: string, signal: AbortSignal) {
      return (await request(`${roomPath(id)}/invites`, roomInvitesResponseSchema, signal)).invites;
    },
    createInvite(id: string, expiresInMinutes: number, maxUses: number, signal: AbortSignal) {
      return request(`${roomPath(id)}/invites`, inviteCreatedSchema, signal, {
        expiresInMinutes,
        maxUses,
      });
    },
    acceptInvite(token: string, signal: AbortSignal) {
      return request('/v1/invites/accept', inviteAcceptedSchema, signal, { token });
    },
    revokeInvite(id: string, inviteId: string, signal: AbortSignal) {
      return request(
        `${roomPath(id)}/invites/${encodeURIComponent(inviteId)}`,
        emptySchema,
        signal,
        undefined,
        'DELETE',
      );
    },
    member(id: string, userId: string, approve: boolean, signal: AbortSignal) {
      return request(
        `${roomPath(id)}/members/${encodeURIComponent(userId)}${approve ? '/approve' : ''}`,
        roomSnapshotSchema,
        signal,
        approve ? {} : undefined,
        approve ? 'POST' : 'DELETE',
      );
    },
    prepare(id: string, signal: AbortSignal) {
      return request(`${roomPath(id)}/sessions`, roomSnapshotSchema, signal, {});
    },
    transition(snapshot: RoomSnapshot, action: 'activate' | 'close', signal: AbortSignal) {
      if (!snapshot.session) throw new Error('A current media session is required');

      return request(
        `${roomPath(snapshot.room.id)}/sessions/${snapshot.session.id}/${action}`,
        roomSnapshotSchema,
        signal,
        { epoch: snapshot.session.epoch, membershipRevision: snapshot.session.membershipRevision },
      );
    },
    async grant(
      snapshot: RoomSnapshot,
      role: 'publisher' | 'viewer',
      signal: AbortSignal,
      includeAudio = false,
    ) {
      if (!snapshot.session) throw new Error('A current media session is required');

      return (
        await request(`${roomPath(snapshot.room.id)}/grants`, productGrantResponseSchema, signal, {
          role,
          sessionId: snapshot.session.id,
          epoch: snapshot.session.epoch,
          includeAudio,
        })
      ).grant;
    },
  };
}

export type ProductApi = ReturnType<typeof createProductApi>;
