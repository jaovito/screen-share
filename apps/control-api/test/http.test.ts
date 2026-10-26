import { describe, expect, it } from 'bun:test';
import { profilesResponseSchema } from '@screen-share/contracts';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/modules/system/adapters/postgres.js';

describe('HTTP de controle', () => {
  it('separa liveness de readiness e saneia falhas', async () => {
    const app = createApp(
      {
        check: async () => {
          throw new Error('password=secret');
        },
      },
      ['http://localhost:5173'],
    );

    expect((await app.request('/healthz')).status).toBe(200);

    const ready = await app.request('/readyz');

    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: 'unavailable' });
    expect(ready.headers.get('X-Request-ID')).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('entrega contrato e somente CORS autorizado; não emite tokens', async () => {
    const app = createApp({ check: async () => {} }, ['http://localhost:5173']);

    expect((await app.request('/readyz')).status).toBe(200);

    const result = await app.request('/v1/video-profiles', {
      headers: { Origin: 'https://evil.example' },
    });

    expect(profilesResponseSchema.parse(await result.json()).profiles).toHaveLength(8);
    expect(result.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect((await app.request('/token', { method: 'POST' })).status).toBe(404);
  });
  it('banco indisponível responde dentro do limite', async () => {
    const database = createDatabase('postgres://invalid:invalid@127.0.0.1:1/invalid');

    try {
      expect((await createApp(database.readiness, []).request('/readyz')).status).toBe(503);
    } finally {
      await database.close();
    }
  });
  it('configuração inválida nunca expõe valores secretos', () => {
    expect(() => readConfig({ DATABASE_URL: 'private-secret' })).toThrow('Configuração inválida:');

    try {
      readConfig({ DATABASE_URL: 'private-secret' });
    } catch (e) {
      expect(String(e)).not.toContain('private-secret');
    }
  });
});
