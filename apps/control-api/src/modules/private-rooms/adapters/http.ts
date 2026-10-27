import {
  acceptInviteSchema,
  createInviteSchema,
  createRoomSchema,
  inviteAcceptedSchema,
  inviteCreatedSchema,
  peerReportsSchema,
  productGrantResponseSchema,
  receiverReportSchema,
  reportAcceptedSchema,
  requestProductGrantSchema,
  roomInvitesResponseSchema,
  roomListSchema,
  roomSnapshotSchema,
  sessionTransitionSchema,
} from '@screen-share/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Identity } from '../../identity/adapters/better-auth';
import type { RoomStore } from '../application/ports';
import type { RoomReports } from '../application/reports';
import type { RoomService } from '../application/service';
import { RoomError } from '../domain/policy';

type Environment = { Variables: { actor: string } };
const id = z.uuid();

export function productRoutes(
  identity: Identity,
  service: RoomService,
  store: RoomStore,
  origins: string[],
  reports?: RoomReports,
) {
  const routes = new Hono<Environment>();
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (!origin || !origins.includes(origin)) return c.json({ error: 'invalid_origin' }, 403);
      if (c.req.header('sec-fetch-site') === 'cross-site')
        return c.json({ error: 'invalid_origin' }, 403);
      if (
        c.req.method !== 'DELETE' &&
        !c.req.header('content-type')?.startsWith('application/json')
      )
        return c.json({ error: 'invalid_content_type' }, 400);
    }
    const actor = await identity.identity(c.req.raw.headers);
    if (!actor) return c.json({ error: 'unauthorized' }, 401);
    const limit = await store.consumeLimit(`product:${actor.id}`, 60, 120);
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfter ?? 60));
      return c.json({ error: 'rate_limited' }, 429);
    }
    c.set('actor', actor.id);
    await next();
  });
  routes.get('/rooms', async (c) =>
    c.json(roomListSchema.parse({ rooms: await service.list(c.get('actor')) })),
  );
  routes.post('/rooms/:id/reports', async (c) => {
    if (!reports) throw new RoomError('service_unavailable', 503);
    const input = receiverReportSchema.parse(await c.req.json());
    return c.json(
      reportAcceptedSchema.parse(
        await reports.submit(c.get('actor'), id.parse(c.req.param('id')), input),
      ),
    );
  });
  routes.get('/rooms/:id/reports', async (c) => {
    if (!reports) throw new RoomError('service_unavailable', 503);
    return c.json(
      peerReportsSchema.parse(await reports.list(c.get('actor'), id.parse(c.req.param('id')))),
    );
  });
  routes.post('/rooms', async (c) => {
    const input = createRoomSchema.parse(await c.req.json());
    return c.json(roomSnapshotSchema.parse(await service.create(c.get('actor'), input.name)), 201);
  });
  routes.post('/invites/accept', async (c) => {
    const input = acceptInviteSchema.parse(await c.req.json());
    return c.json(
      inviteAcceptedSchema.parse(await service.accept(c.get('actor'), input.token)),
      201,
    );
  });
  routes.get('/rooms/:id', async (c) =>
    c.json(
      roomSnapshotSchema.parse(await service.get(c.get('actor'), id.parse(c.req.param('id')))),
    ),
  );
  routes.get('/rooms/:id/invites', async (c) =>
    c.json(
      roomInvitesResponseSchema.parse(
        await service.listInvites(c.get('actor'), id.parse(c.req.param('id'))),
      ),
    ),
  );
  routes.post('/rooms/:id/invites', async (c) => {
    const input = createInviteSchema.parse(await c.req.json());
    return c.json(
      inviteCreatedSchema.parse(
        await service.invite(
          c.get('actor'),
          id.parse(c.req.param('id')),
          input.expiresInMinutes,
          input.maxUses,
        ),
      ),
      201,
    );
  });
  routes.delete('/rooms/:id/invites/:inviteId', async (c) =>
    c.json(
      await service.revokeInvite(
        c.get('actor'),
        id.parse(c.req.param('id')),
        id.parse(c.req.param('inviteId')),
      ),
    ),
  );
  routes.post('/rooms/:id/members/:userId/approve', async (c) =>
    c.json(
      roomSnapshotSchema.parse(
        await service.approve(
          c.get('actor'),
          id.parse(c.req.param('id')),
          id.parse(c.req.param('userId')),
        ),
      ),
    ),
  );
  routes.delete('/rooms/:id/members/:userId', async (c) =>
    c.json(
      roomSnapshotSchema.parse(
        await service.remove(
          c.get('actor'),
          id.parse(c.req.param('id')),
          id.parse(c.req.param('userId')),
        ),
      ),
    ),
  );
  routes.post('/rooms/:id/sessions', async (c) =>
    c.json(
      roomSnapshotSchema.parse(await service.prepare(c.get('actor'), id.parse(c.req.param('id')))),
      201,
    ),
  );
  routes.post('/rooms/:id/sessions/:sessionId/:action', async (c) => {
    const action = z.enum(['activate', 'close']).parse(c.req.param('action'));
    const input = sessionTransitionSchema.parse(await c.req.json());
    return c.json(
      roomSnapshotSchema.parse(
        await service.transition(
          c.get('actor'),
          id.parse(c.req.param('id')),
          id.parse(c.req.param('sessionId')),
          input.epoch,
          input.membershipRevision,
          action,
        ),
      ),
    );
  });
  routes.post('/rooms/:id/grants', async (c) => {
    const input = requestProductGrantSchema.parse(await c.req.json());
    return c.json(
      productGrantResponseSchema.parse(
        await service.grant(
          c.get('actor'),
          id.parse(c.req.param('id')),
          input.sessionId,
          input.epoch,
          input.role,
          input.includeAudio,
        ),
      ),
    );
  });
  routes.onError((error, c) => {
    if (error instanceof RoomError) return c.json({ error: error.code }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json({ error: 'invalid_request' }, 400);
    return c.json({ error: 'service_unavailable' }, 503);
  });
  return routes;
}
