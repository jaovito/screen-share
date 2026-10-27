import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { envFile, loadEnv, root } from './lib';

export function bootstrap() {
  if (!existsSync(envFile)) {
    const password = randomBytes(32).toString('hex');
    const values = {
      POSTGRES_PASSWORD: password,
      DATABASE_URL: `postgresql://screen_share:${password}@127.0.0.1:5432/screen_share`,
      LIVEKIT_API_KEY: `ss_${randomBytes(18).toString('hex')}`,
      LIVEKIT_API_SECRET: randomBytes(48).toString('hex'),
      AUTH_SECRET: randomBytes(48).toString('hex'),
    };
    let template = readFileSync(resolve(root, '.env.example'), 'utf8');

    for (const [key, value] of Object.entries(values))
      template = template.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);

    writeFileSync(envFile, template, { flag: 'wx', mode: 0o600 });
    console.log('.env created with random secrets.');
  } else console.log('.env preserved.');

  // Upgrade only missing product settings; never rotate existing signing material.
  const current = readFileSync(envFile, 'utf8');
  const additions = {
    AUTH_SECRET: randomBytes(48).toString('hex'),
    AUTH_BASE_URL: 'http://127.0.0.1:3000',
    LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:7880',
  };

  for (const [key, value] of Object.entries(additions)) {
    if (!new RegExp(`^${key}=`, 'm').test(current)) appendFileSync(envFile, `\n${key}=${value}\n`);
  }

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
      throw new Error('Review LIVEKIT_API_KEY, LIVEKIT_API_SECRET and LIVEKIT_NODE_IP in .env.');

    const template = readFileSync(resolve(root, 'infra/livekit/config.template.yaml'), 'utf8');

    writeFileSync(
      config,
      template
        .replace('__API_KEY__', JSON.stringify(key))
        .replace('__API_SECRET__', JSON.stringify(secret))
        .replace('__NODE_IP__', JSON.stringify(ip)),
      { flag: 'wx', mode: 0o600 },
    );
    console.log('Local LiveKit configuration created.');
  } else console.log('LiveKit configuration preserved.');
}
