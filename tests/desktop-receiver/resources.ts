import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { run } from '../../scripts/lib';

const release = 'https://github.com/livekit/livekit/releases/download/v1.13.11/';
const filename = 'livekit_1.13.11_windows_amd64.zip';
const checksum = '5d071ea43339f0140d24a66f0b2ff8a7bf6c4d0dceb19b30abca835670213667';

export async function downloadSfu(directory: string) {
  const response = await fetch(`${release}${filename}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('Official pinned Windows SFU download failed');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength > 50 * 1024 * 1024 ||
    createHash('sha256').update(bytes).digest('hex') !== checksum
  )
    throw new Error('Official pinned Windows SFU checksum mismatch');
  const archive = join(directory, filename);
  const extractor = join(directory, 'extract.ps1');
  await writeFile(archive, bytes, { flag: 'wx' });
  await writeFile(
    extractor,
    'param([string]$ArchivePath, [string]$Destination)\n$ErrorActionPreference = "Stop"\nExpand-Archive -LiteralPath $ArchivePath -DestinationPath $Destination\n',
    { flag: 'wx' },
  );
  await run('powershell', [
    '-NoProfile',
    '-File',
    extractor,
    '-ArchivePath',
    archive,
    '-Destination',
    join(directory, 'sfu'),
  ]);
  return join(directory, 'sfu', 'livekit-server.exe');
}

export function ownedProcess(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, { env, stdio: 'ignore', windowsHide: false });
  let failure = false;
  child.on('error', () => {
    failure = true;
  });
  const closed = new Promise<void>((resolveClosed) => {
    child.once('close', () => resolveClosed());
    child.once('error', () => resolveClosed());
  });
  return {
    child,
    alive() {
      return !failure && child.exitCode === null;
    },
    async stop() {
      if (child.pid && child.exitCode === null && !failure) {
        // Only process IDs created by this fixture are eligible for tree cleanup.
        if (process.platform === 'win32')
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            timeout: 10_000,
            windowsHide: true,
          });
        else child.kill('SIGKILL');
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Owned process did not close')), 4000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export async function removeOwnedDirectory(directory: string) {
  if (
    resolve(dirname(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('ss-desktop-receiver-')
  )
    throw new Error('Cleanup requires the fixture-owned temporary directory');
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    // Windows archive attributes/Bun filesystem handles can reject recursive rm.
    // Use the native remover only after every process/server has closed.
    await run(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; if (Test-Path -LiteralPath $env:SS_OWNED_FIXTURE_DIR) { Remove-Item -LiteralPath $env:SS_OWNED_FIXTURE_DIR -Recurse -Force }',
      ],
      { env: { ...process.env, SS_OWNED_FIXTURE_DIR: directory }, timeout: 10_000 },
    );
  }
}

export async function waitFor(url: string, alive: () => boolean, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && alive()) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      /* Startup retries are bounded to the owned server. */
    }
    await Bun.sleep(100);
  }
  throw new Error('Owned desktop receiver resource did not become ready');
}
