import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { envFile, loadEnv, root } from './lib.ts';

export function bootstrap() {
  if (!existsSync(envFile)) {
    const password = randomBytes(32).toString('hex');
    const values = {
      POSTGRES_PASSWORD: password,
      DATABASE_URL: `postgresql://screen_share:${password}@127.0.0.1:5432/screen_share`,
      LIVEKIT_API_KEY: `ss_${randomBytes(18).toString('hex')}`,
      LIVEKIT_API_SECRET: randomBytes(48).toString('hex'),
    };
    let template = readFileSync(resolve(root, '.env.example'), 'utf8');

    for (const [key, value] of Object.entries(values))
      template = template.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);

    writeFileSync(envFile, template, { flag: 'wx', mode: 0o600 });
    console.log('.env criado com segredos aleatórios.');
  } else console.log('.env preservado.');

  loadEnv();

  const config = resolve(root, 'infra/livekit/local.yaml');

  if (!existsSync(config)) {
    const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, LIVEKIT_NODE_IP: ip } = process.env;

    if (
      !key ||
      !/^[a-zA-Z0-9_-]{12,}$/.test(key) ||
      !secret ||
      secret.length < 32 ||
      !ip ||
      !isIP(ip)
    )
      throw new Error('Revise LIVEKIT_API_KEY, LIVEKIT_API_SECRET e LIVEKIT_NODE_IP no .env.');

    const template = readFileSync(resolve(root, 'infra/livekit/config.template.yaml'), 'utf8');

    writeFileSync(
      config,
      template
        .replace('__API_KEY__', JSON.stringify(key))
        .replace('__API_SECRET__', JSON.stringify(secret))
        .replace('__NODE_IP__', JSON.stringify(ip)),
      { flag: 'wx', mode: 0o600 },
    );
    console.log('Configuração local do LiveKit criada.');
  } else console.log('Configuração LiveKit preservada.');
}
