import { buildWorkspaces, run } from './lib';
import { freePort } from './ports';
import { withTestDatabase } from './test-database';

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

  await buildWorkspaces(env, ['viewer-web', 'desktop']);
  await run('bun', ['run', '--filter', '@screen-share/control-api', 'migrate'], { env });
  await run('bun', ['--bun', 'node_modules/@playwright/test/cli.js', 'test', ...args], { env });
});
