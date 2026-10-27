import { randomUUID } from 'node:crypto';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { Config } from '../../../config';
import type { RoomStore } from '../../private-rooms/application/ports';
import * as schema from './schema';

export function createIdentity(pool: pg.Pool, config: Config, store: RoomStore) {
  const secure = new URL(config.AUTH_BASE_URL).protocol === 'https:';
  const auth = betterAuth({
    appName: 'Screen Share',
    baseURL: config.AUTH_BASE_URL,
    secret: config.AUTH_SECRET,
    database: drizzleAdapter(drizzle(pool), { provider: 'pg', schema, transaction: true }),
    trustedOrigins: [...config.CORS_ORIGINS, new URL(config.AUTH_BASE_URL).origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: { expiresIn: 86400, updateAge: 3600, cookieCache: { enabled: false } },
    advanced: {
      database: { generateId: () => randomUUID() },
      useSecureCookies: secure,
      cookiePrefix: 'screen-share',
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-internal-client-ip'] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 20 },
      },
      customStorage: {
        consume: (key, rule) => store.consumeLimit(`auth:${key}`, rule.window, rule.max),
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (user.name.trim().length < 1 || user.name.trim().length > 100)
              throw new APIError('BAD_REQUEST', {
                message: 'Display name must contain 1–100 characters.',
              });
            return { data: { ...user, name: user.name.trim() } };
          },
        },
      },
    },
    // Application audit events remain enabled; upstream diagnostics may contain
    // credentials or driver details and are not an application audit stream.
    logger: { disabled: true },
  });
  return {
    async handler(request: Request) {
      const response = await auth.handler(request);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      if (response.status >= 500)
        return Response.json({ error: 'auth_unavailable' }, { status: 503, headers });
      if (!response.headers.get('content-type')?.includes('application/json')) return response;
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return Response.json(payload, { status: response.status, headers });
      const sanitized = { ...payload };
      if ('token' in sanitized) delete sanitized.token;
      if ('session' in sanitized) delete sanitized.session;
      return Response.json(sanitized, { status: response.status, headers });
    },
    async identity(headers: Headers) {
      const value = await auth.api.getSession({ headers });
      return value ? { id: value.user.id, name: value.user.name, email: value.user.email } : null;
    },
  };
}

export type Identity = ReturnType<typeof createIdentity>;
