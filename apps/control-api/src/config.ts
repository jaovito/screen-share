import { mediaProofServerSchema } from '@screen-share/contracts';
import { z } from 'zod';

function hasProtocol(value: string, protocols: string[]) {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const httpUrl = z.url().refine((value) => hasProtocol(value, ['http:', 'https:']));
const schema = z.object({
  AUTH_SECRET: z.string().min(32),
  AUTH_BASE_URL: httpUrl.refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  }),
  LIVEKIT_PUBLIC_URL: mediaProofServerSchema,
  DATABASE_URL: z.url().refine((value) => hasProtocol(value, ['postgres:', 'postgresql:'])),
  HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGINS: z
    .string()
    .transform((v) => v.split(','))
    .pipe(z.array(httpUrl).min(1)),
  LIVEKIT_URL: httpUrl,
  LIVEKIT_API_KEY: z.string().regex(/^[a-zA-Z0-9_-]{12,}$/),
  LIVEKIT_API_SECRET: z.string().min(32),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);

  if (!result.success)
    throw new Error(
      `Invalid configuration: ${[...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', ')}`,
    );

  return result.data;
}

export type Config = ReturnType<typeof readConfig>;
