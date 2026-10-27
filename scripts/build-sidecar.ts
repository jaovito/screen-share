import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, run } from './lib';

export function desktopEnvironment() {
  const env = { ...process.env };
  for (const key of [
    'AUTH_SECRET',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'DATABASE_URL',
    'POSTGRES_PASSWORD',
  ])
    delete env[key];
  return env;
}

export async function buildSidecar() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('The native publisher requires a Windows x64 build host.');

  // The static CRT is required by the pinned native WebRTC SDK. Build serially
  // before Tauri so one dependency graph does not compete for machine resources.
  await run(
    'cargo',
    ['build', '--locked', '--release', '-p', 'ss-media-proof', '--features', 'native-proof'],
    {
      env: {
        ...desktopEnvironment(),
        CARGO_BUILD_JOBS: '2',
        CMAKE_BUILD_PARALLEL_LEVEL: '2',
        RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} -C target-feature=+crt-static`.trim(),
      },
    },
  );
  const directory = resolve(root, 'apps/desktop/src-tauri/binaries');
  await mkdir(directory, { recursive: true });
  await copyFile(
    resolve(root, 'target/release/ss-media-proof.exe'),
    resolve(directory, 'ss-media-proof-x86_64-pc-windows-msvc.exe'),
  );
}

if (import.meta.main) await buildSidecar();
