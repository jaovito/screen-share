import { type SpawnOptions, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const envFile = resolve(root, '.env');

export function loadEnv() {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function start(command: string, args: string[], options: SpawnOptions = {}) {
  return spawn(command === 'bun' && process.versions.bun ? process.execPath : command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
}

export function run(command: string, args: string[], options: SpawnOptions = {}) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = start(command, args, options);

    child.on('error', () =>
      reject(new Error(`Could not execute ${command}. Check its installation.`)),
    );
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} failed (code ${code ?? 'interrupted'}).`)),
    );
  });
}

export const composeArgs = [
  'compose',
  '--env-file',
  envFile,
  '-f',
  resolve(root, 'infra/compose.yaml'),
];
export const compose = (...args: string[]) => run('docker', [...composeArgs, ...args]);

export const workspaceApps = ['control-api', 'viewer-web', 'desktop'] as const;

export async function buildWorkspaces(
  env: NodeJS.ProcessEnv = process.env,
  apps: readonly (typeof workspaceApps)[number][] = workspaceApps,
) {
  await run('bun', ['run', '--filter', '@screen-share/contracts', 'typecheck'], { env });
  await Promise.all(
    apps.map((name) => run('bun', ['run', '--filter', `@screen-share/${name}`, 'build'], { env })),
  );
}

export async function typecheckWorkspaces() {
  await run('bun', ['run', '--filter', '@screen-share/ui', 'typecheck']);
  await run('bun', ['run', '--filter', '@screen-share/contracts', 'typecheck']);
  await Promise.all(
    workspaceApps.map((name) =>
      run('bun', ['run', '--filter', `@screen-share/${name}`, 'typecheck']),
    ),
  );
  await run('bun', ['--bun', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
}
