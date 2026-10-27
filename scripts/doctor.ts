import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { composeArgs, envFile, root } from './lib';

export async function doctor() {
  let problems = 0;
  const report = (ok: boolean, label: string, help: string) => {
    console.log(`${ok ? 'OK' : 'ATTENTION'} ${label}${ok ? '' : `: ${help}`}`);

    if (!ok) problems++;
  };
  const bunVersion = readFileSync(resolve(root, '.bun-version'), 'utf8').trim();
  report(
    process.versions.bun === bunVersion,
    `Bun ${process.versions.bun ?? 'missing'}`,
    `activate Bun ${bunVersion}`,
  );
  report(existsSync(envFile), '.env', 'run bun run bootstrap');
  report(
    existsSync(resolve(root, 'infra/livekit/local.yaml')),
    'LiveKit configuration',
    'run bun run bootstrap',
  );

  for (const [tool, args, hint] of [
    ['rustc', ['--version'], '1.99.1 + rustfmt/clippy'],
    ['cargo', ['fmt', '--version'], 'install component rustfmt'],
    ['cargo', ['clippy', '--version'], 'install component clippy'],
    ['docker', ['compose', 'version'], 'Docker with Compose v2'],
    ['docker', ['info', '--format', '{{.ServerVersion}}'], 'start Docker Desktop/OrbStack'],
  ] as const) {
    const result = spawnSync(tool, [...args], { cwd: root, encoding: 'utf8', timeout: 20000 });

    report(
      result.status === 0 && (tool !== 'rustc' || result.stdout.startsWith('rustc 1.99.1 ')),
      `${tool} ${args[0]}`,
      hint,
    );
  }

  const required = [
    'DATABASE_URL',
    'POSTGRES_USER',
    'POSTGRES_DB',
    'POSTGRES_PASSWORD',
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'CORS_ORIGINS',
    'AUTH_SECRET',
    'AUTH_BASE_URL',
    'LIVEKIT_PUBLIC_URL',
  ];

  report(
    required.every(
      (key) => process.env[key] && !process.env[key].includes('GENERATED_BY_BOOTSTRAP'),
    ),
    'required variables',
    'complete .env without placeholders',
  );

  const configCheck = spawnSync(
    process.execPath,
    ['--eval', 'import { readConfig } from "./apps/control-api/src/config"; readConfig();'],
    { cwd: root, encoding: 'utf8', timeout: 10000 },
  );

  report(
    configCheck.status === 0,
    'API configuration schema',
    'install dependencies and review .env names/formats; details omitted',
  );

  const compose = spawnSync('docker', [...composeArgs, '--profile', 'app', 'config', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
  });

  report(
    compose.status === 0,
    'Compose valid (resolved output hidden)',
    'check .env and infra/compose.yaml',
  );

  for (const port of [
    3000,
    Number(process.env.VIEWER_PORT ?? 5173),
    1420,
    5432,
    7880,
    7881,
  ] as const) {
    const available = await new Promise((resolvePromise) => {
      const server = createServer();

      server.once('error', () => resolvePromise(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)));
    });

    console.log(
      `INFO TCP port ${port}: ${available ? 'free' : 'occupied or permission denied (a service may already be running)'}`,
    );
  }

  console.log('INFO UDP 7882/ICE and media between PCs require M1 acceptance evidence.');
  console.log(
    process.platform === 'win32'
      ? 'INFO Desktop: confirm Windows 11 x64, MSVC C++/Windows SDK and WebView2.'
      : 'INFO Windows desktop cannot be validated on this OS; portable checks are available.',
  );

  if (problems) process.exitCode = 1;
}
