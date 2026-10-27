import { afterAll, beforeAll, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createProductRuntime } from '@modules/private-rooms';
import { createRoomStore } from '@modules/private-rooms/adapters/postgres';
import { createDatabase } from '@modules/system/adapters/postgres';
import { roomSnapshotSchema } from '@screen-share/contracts';
import pg from 'pg';
import { createApp } from '../src/app';
import { readConfig } from '../src/config';

if (process.env.INTEGRATION_DATABASE !== 'disposable')
  throw new Error('Disposable database required');
const parent = readConfig();
const name = `product_${randomUUID().replaceAll('-', '')}`;
const url = new URL(parent.DATABASE_URL);
url.pathname = `/${name}`;
const admin = new pg.Pool({ connectionString: parent.DATABASE_URL, max: 1 });
export const database = createDatabase(url.toString());
export const config = {
  ...parent,
  DATABASE_URL: url.toString(),
  LIVEKIT_URL: 'http://127.0.0.1:1',
  AUTH_BASE_URL: 'http://127.0.0.1:3000',
  CORS_ORIGINS: ['http://127.0.0.1:5173'],
};
const runtime = createProductRuntime(database.pool, config);
export const app = createApp(database.readiness, config.CORS_ORIGINS, runtime);
export const store = createRoomStore(database.pool);
export const headers = {
  origin: 'http://127.0.0.1:5173',
  'content-type': 'application/json',
  'x-internal-client-ip': '127.0.0.1',
};
let sequence = 0;

beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${name}"`);
  await database.migrate();
});
afterAll(async () => {
  await runtime.stop();
  await database.close();
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
});

export async function request(path: string, method = 'GET', cookie = '', body?: unknown) {
  return app.request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: { ...headers, cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export async function account() {
  sequence++;
  const response = await request('/api/auth/sign-up/email', 'POST', '', {
    name: `Member ${sequence}`,
    email: `member-${sequence}@example.test`,
    password: 'Synthetic-password-1234',
  });
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  expect(value).not.toHaveProperty('token');
  if (
    !value ||
    typeof value !== 'object' ||
    !('user' in value) ||
    !value.user ||
    typeof value.user !== 'object' ||
    !('id' in value.user) ||
    typeof value.user.id !== 'string'
  )
    throw new Error('Expected a registered user');
  const cookies = response.headers.getSetCookie();
  expect(cookies.some((cookie) => /HttpOnly/i.test(cookie))).toBe(true);
  expect(cookies.some((cookie) => /SameSite=Lax/i.test(cookie))).toBe(true);
  return { id: value.user.id, cookie: cookies.map((cookie) => cookie.split(';')[0]).join('; ') };
}
export async function createRoom(cookie: string) {
  const response = await request('/v1/rooms', 'POST', cookie, { name: 'Private integration room' });
  expect(response.status).toBe(201);
  return roomSnapshotSchema.parse(await response.json());
}
export async function invite(cookie: string, roomId: string, maxUses = 1) {
  const response = await request(`/v1/rooms/${roomId}/invites`, 'POST', cookie, {
    maxUses,
    expiresInMinutes: 5,
  });
  expect(response.status).toBe(201);
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== 'object' ||
    !('token' in value) ||
    typeof value.token !== 'string' ||
    !('id' in value) ||
    typeof value.id !== 'string'
  )
    throw new Error('Expected an invite');
  return { token: value.token, id: value.id };
}
