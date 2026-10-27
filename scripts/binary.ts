import type { ChildProcess } from 'node:child_process';
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { profilesResponseSchema } from '@screen-share/contracts';
import { root, run, start } from './lib';
import { freePort } from './ports';
import { withTestDatabase } from './test-database';

await run('bun', ['run', '--filter', '@screen-share/control-api', 'build']);
await withTestDatabase(async (databaseEnv) => {
  const directory = await mkdtemp(join(tmpdir(), 'screen-share-binary-'));
  const name = process.platform === 'win32' ? 'control-api.exe' : 'control-api';
  const executable = join(directory, name);
  const port = await freePort();
  const env = {
    ...databaseEnv,
    PORT: port,
    HOST: '127.0.0.1',
    CORS_ORIGINS: 'http://localhost:5173',
    LIVEKIT_URL: 'http://127.0.0.1:1',
    LIVEKIT_API_KEY: 'binary-test-key',
    LIVEKIT_API_SECRET: 'binary-test-secret-with-at-least-32-characters',
  };
  let server: ChildProcess | undefined;
  let exited: Promise<number | null> | undefined;
  try {
    await copyFile(join(root, 'apps/control-api/dist', name), executable);
    await chmod(executable, 0o755);
    const options = { cwd: directory, env, stdio: 'ignore' as const };
    await run(executable, ['migrate'], options);
    await run(executable, ['migrate'], options);
    server = start(executable, [], options);
    exited = new Promise<number | null>((resolve) => {
      server?.once('error', () => resolve(1));
      server?.once('exit', resolve);
    });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error('Standalone API exited before readiness');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Retry only the test-owned local process. */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error('Standalone API readiness timed out');
    await run(executable, ['ready'], options);
    const catalog = await fetch(`http://127.0.0.1:${port}/v1/video-profiles`);
    profilesResponseSchema.parse(await catalog.json());
    const token = await fetch(`http://127.0.0.1:${port}/token`, { method: 'POST' });
    if (token.status !== 404) throw new Error('Standalone API unexpectedly exposes tokens');
    server.kill('SIGTERM');
    const timeout = setTimeout(() => server?.kill('SIGKILL'), 9000);
    try {
      if ((await exited) !== 0) throw new Error('Standalone API shutdown failed');
    } finally {
      clearTimeout(timeout);
    }
    console.log(
      'Standalone binary passed: embedded migrations, isolated CWD, readiness, catalog, shutdown.',
    );
  } finally {
    if (server?.exitCode === null && server.signalCode === null) {
      server.kill('SIGKILL');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
