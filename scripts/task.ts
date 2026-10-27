import { bootstrap } from './bootstrap';
import { buildSidecar, desktopEnvironment } from './build-sidecar';
import { doctor } from './doctor';
import { buildWorkspaces, compose, loadEnv, run, start, typecheckWorkspaces } from './lib';
import { runTestSuites } from './test-suites';

loadEnv();

const command = process.argv[2];
const contracts = () => run('bun', ['run', '--filter', '@screen-share/contracts', 'typecheck']);

async function checkTs() {
  await run('bun', ['--bun', 'node_modules/@biomejs/biome/bin/biome', 'check', '.']);
  await typecheckWorkspaces();
  await run('bun', ['run', 'check:architecture']);
  await runTestSuites();
  await buildWorkspaces();
}

async function checkRust() {
  await run('cargo', ['fmt', '--all', '--', '--check']);
  await run('cargo', ['clippy', '--locked', '--all-targets', '--', '-D', 'warnings']);
  await run('cargo', ['test', '--locked']);
}

async function dev() {
  await contracts();

  const children = [
    start('bun', ['run', '--filter', '@screen-share/control-api', 'dev']),
    start('bun', ['run', '--filter', '@screen-share/viewer-web', 'dev']),
  ];
  let stopping = false;
  const stop = () => {
    stopping = true;

    for (const child of children) child.kill('SIGTERM');
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolvePromise, reject) => {
          child.once('error', (error) => {
            stop();
            reject(error);
          });
          child.once('exit', (code) => {
            const expected = stopping;

            stop();

            if (code && !expected) reject(new Error('Servidor de desenvolvimento falhou'));
            else resolvePromise();
          });
        }),
    ),
  );
}

async function desktop(build: boolean) {
  if (process.platform !== 'win32')
    throw new Error(
      'O fluxo desktop de M0 requer Windows 11 x64, MSVC e WebView2. Use check:rust/check:ts neste SO.',
    );

  await contracts();
  await buildSidecar();
  await run(
    'bun',
    [
      'run',
      '--filter',
      '@screen-share/desktop',
      'tauri',
      build ? 'build' : 'dev',
      ...(process.env.SCREEN_SHARE_RELEASE_CONFIG
        ? ['--config', process.env.SCREEN_SHARE_RELEASE_CONFIG]
        : []),
    ],
    {
      env: {
        ...desktopEnvironment(),
        SCREEN_SHARE_API_URL:
          process.env.SCREEN_SHARE_API_URL ?? process.env.VITE_API_URL ?? 'http://127.0.0.1:3000',
        CARGO_BUILD_JOBS: '2',
      },
    },
  );
}

async function main() {
  switch (command) {
    case 'test':
      await contracts();
      await runTestSuites();
      break;
    case 'build':
      await buildWorkspaces();
      break;
    case 'typecheck':
      await typecheckWorkspaces();
      break;
    case 'bootstrap':
      bootstrap();
      break;
    case 'doctor':
      await doctor();
      break;
    case 'infra:up':
      await compose('up', '-d', '--wait', 'postgres', 'livekit');
      break;
    case 'infra:down':
      await compose('stop', 'postgres', 'livekit');
      break;
    case 'db:migrate':
      await contracts();
      await run('bun', ['run', '--filter', '@screen-share/control-api', 'migrate']);
      break;
    case 'dev':
      await dev();
      break;
    case 'dev:desktop':
      await desktop(false);
      break;
    case 'build:desktop':
      await desktop(true);
      break;
    case 'stack:up':
      await compose('up', '-d', '--wait', 'postgres', 'livekit');
      await compose('--profile', 'app', 'stop', 'control-api');
      await compose('--profile', 'app', 'build', 'control-api');
      await compose('--profile', 'app', 'run', '--rm', 'migrate');
      await compose('--profile', 'app', 'up', '-d', '--no-deps', '--wait', 'control-api');
      break;
    case 'stack:down':
      await compose('--profile', 'app', 'down');
      break;
    case 'check:ts':
      await checkTs();
      break;
    case 'check:rust':
      await checkRust();
      break;
    case 'check':
      await checkTs();
      await checkRust();
      await import('./coverage');
      break;
    case 'smoke':
      await contracts();
      await run('bun', ['run', '--filter', '@screen-share/control-api', 'smoke']);
      break;
    case 'test:integration':
      await import('./integration');
      break;
    case 'test:binary':
      await import('./binary');
      break;
    case 'test:e2e':
      await import('./e2e');
      break;
    case 'test:coverage':
      await import('./coverage');
      break;
    case 'test:persistence':
      await import('./persistence');
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Command failed');
  process.exitCode = 1;
});
