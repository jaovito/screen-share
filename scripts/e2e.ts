import { createServer } from 'node:net';
import { buildWorkspaces, run } from './lib.ts';
import { withTestDatabase } from './test-database.ts';

async function freePort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Porta indisponível'));
        server.close();

        return;
      }

      server.close(() => resolve(String(address.port)));
    });
  });
}

const args = process.argv.slice(3);

if (args[0] === '--') args.shift();

const [api, viewer, desktop] = await Promise.all([freePort(), freePort(), freePort()]);

await withTestDatabase(async (databaseEnv) => {
  const env = {
    ...databaseEnv,
    PORT: api,
    HOST: '127.0.0.1',
    E2E_API_PORT: api,
    E2E_VIEWER_PORT: viewer,
    E2E_DESKTOP_PORT: desktop,
    VITE_API_URL: `http://127.0.0.1:${api}`,
    CORS_ORIGINS: `http://127.0.0.1:${viewer}`,
  };

  await buildWorkspaces(env);
  await run('bun', ['run', '--filter', '@screen-share/control-api', 'migrate'], { env });
  await run('bun', ['--bun', 'node_modules/@playwright/test/cli.js', 'test', ...args], { env });
});
