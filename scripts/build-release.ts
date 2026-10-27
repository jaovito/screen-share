import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { root, run } from './lib';

const args = process.argv.slice(2);
if (args.some((argument) => argument !== '--check') || args.length > 1)
  throw new Error('Use build-release.ts with no options, or --check for input validation only');
const checkOnly = args.includes('--check');
const manifest = z
  .object({ version: z.string(), repository: z.object({ url: z.url() }) })
  .parse(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')));
const desktop = z
  .object({ version: z.string() })
  .parse(JSON.parse(await readFile(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')));
const tag = process.env.RELEASE_TAG;
if (
  !tag ||
  !/^v\d+\.\d+\.\d+$/.test(tag) ||
  tag !== `v${manifest.version}` ||
  desktop.version !== manifest.version
) {
  throw new Error(
    'RELEASE_TAG must match the reviewed package and Tauri version (vMAJOR.MINOR.PATCH)',
  );
}
const repositoryUrl = new URL(manifest.repository.url.replace(/\.git$/, ''));
if (
  repositoryUrl.origin !== 'https://github.com' ||
  !/^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repositoryUrl.pathname)
)
  throw new Error('A public GitHub repository is required for this release channel');
const repository = repositoryUrl.pathname.slice(1);
if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== repository)
  throw new Error('Release workflow repository does not match package metadata');
const endpoint = `https://github.com/${repository}/releases/latest/download/latest.json`;
if (
  process.env.SCREEN_SHARE_UPDATE_ENDPOINT &&
  process.env.SCREEN_SHARE_UPDATE_ENDPOINT !== endpoint
)
  throw new Error('Updater endpoint must match the fixed repository release channel');
const api = new URL(process.env.SCREEN_SHARE_API_URL ?? '');
if (
  api.protocol !== 'https:' ||
  api.username ||
  api.password ||
  api.search ||
  api.hash ||
  api.pathname !== '/' ||
  isIP(api.hostname.replace(/^\[|\]$/g, '')) !== 0 ||
  !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(api.hostname) ||
  /(?:^|\.)(?:localhost|local|test|invalid|example)$/.test(api.hostname) ||
  /(?:^|\.)example\.(?:com|net|org)$/.test(api.hostname)
) {
  throw new Error('SCREEN_SHARE_API_URL must be an explicit public HTTPS origin');
}
const rtcValue = process.env.SCREEN_SHARE_RTC_URL ?? '';
const rtc = new URL(rtcValue);
if (
  rtcValue.length > 2048 ||
  /[\s\p{Cc}]/u.test(rtcValue) ||
  rtc.protocol !== 'wss:' ||
  rtc.username ||
  rtc.password ||
  rtc.search ||
  rtc.hash ||
  rtc.pathname !== '/' ||
  isIP(rtc.hostname.replace(/^\[|\]$/g, '')) !== 0 ||
  !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(rtc.hostname) ||
  /(?:^|\.)(?:localhost|local|test|invalid|example)$/.test(rtc.hostname) ||
  /(?:^|\.)example\.(?:com|net|org)$/.test(rtc.hostname)
) {
  throw new Error('SCREEN_SHARE_RTC_URL must be an explicit public WSS origin');
}
const publicKey = process.env.SCREEN_SHARE_UPDATE_PUBLIC_KEY?.trim();
if (!publicKey || publicKey.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey))
  throw new Error('A Tauri-generated updater public key is required');
const decoded = Buffer.from(publicKey, 'base64');
const publicLines = decoded.toString('utf8').trim().split(/\r?\n/);
if (
  decoded.toString('base64') !== publicKey ||
  !publicLines[0]?.startsWith('untrusted comment:') ||
  !publicLines[1] ||
  Buffer.from(publicLines[1], 'base64').length !== 42
) {
  throw new Error(
    'SCREEN_SHARE_UPDATE_PUBLIC_KEY must contain the Tauri public-key file contents, not a path',
  );
}
const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
if (!privateKey || privateKey.length < 32 || privateKey.length > 32_768)
  throw new Error(
    'TAURI_SIGNING_PRIVATE_KEY must be supplied through the protected release environment',
  );
if (checkOnly) {
  console.log(
    'Release input structure passed. No build, signing, tag creation, upload or publication was performed.',
  );
} else {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error(
      'The signed publisher release requires Windows x64 and the pinned MSVC toolchain',
    );
  const revision = (ref: string) => {
    const result = spawnSync('git', ['rev-parse', '--verify', ref], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (result.status !== 0 || !/^[a-f0-9]{40,64}\s*$/.test(result.stdout))
      throw new Error('The reviewed release tag and checked-out commit must exist');
    return result.stdout.trim();
  };
  if (revision(`refs/tags/${tag}^{commit}`) !== revision('HEAD'))
    throw new Error('The release tag must point to the exact checked-out reviewed commit');
  const output = resolve(root, 'target/signed-release', tag);
  // Exclusive staging prevents accidentally replacing an earlier signed delivery.
  await mkdir(resolve(root, 'target/signed-release'), { recursive: true });
  await mkdir(output);
  const temporary = await mkdtemp(join(tmpdir(), 'screen-share-release-'));
  try {
    const config = join(temporary, 'tauri.release.conf.json');
    await writeFile(
      config,
      JSON.stringify({
        bundle: { createUpdaterArtifacts: true },
        plugins: {
          updater: {
            pubkey: publicKey,
            endpoints: [endpoint],
            windows: { installMode: 'basicUi' },
          },
        },
      }),
      { mode: 0o600, flag: 'wx' },
    );
    const environment = { ...process.env };
    for (const name of [
      'DATABASE_URL',
      'POSTGRES_PASSWORD',
      'LIVEKIT_API_KEY',
      'LIVEKIT_API_SECRET',
      'AUTH_SECRET',
    ])
      delete environment[name];
    const started = Date.now();
    await run('bun', ['--no-env-file', 'scripts/task.ts', 'build:desktop'], {
      env: {
        ...environment,
        SCREEN_SHARE_RELEASE_CONFIG: config,
        SCREEN_SHARE_API_URL: api.origin,
        SCREEN_SHARE_RTC_URL: rtc.origin,
        VITE_API_URL: api.origin,
        SCREEN_SHARE_UPDATE_PUBLIC_KEY: publicKey,
        SCREEN_SHARE_UPDATE_ENDPOINT: endpoint,
        CARGO_BUILD_JOBS: '2',
        CMAKE_BUILD_PARALLEL_LEVEL: '2',
      },
    });
    const bundles = resolve(root, 'target/release/bundle/nsis');
    const names = (await readdir(bundles)).filter(
      (name) => name.endsWith('.exe') && name.includes(`_${manifest.version}_`),
    );
    if (names.length !== 1 || !names[0])
      throw new Error('Expected exactly one NSIS installer for this version');
    const name = names[0];
    const installer = join(bundles, name);
    const signatureFile = `${installer}.sig`;
    for (const path of [installer, signatureFile]) {
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size === 0 || metadata.mtimeMs < started - 2000)
        throw new Error('A fresh installer and updater signature are required');
    }
    const signature = (await readFile(signatureFile, 'utf8')).trim();
    if (signature.length < 80 || signature.length > 4096 || !/^[A-Za-z0-9+/=]+$/.test(signature))
      throw new Error('Updater signature is missing or malformed');
    await copyFile(installer, join(output, name));
    await copyFile(signatureFile, join(output, `${name}.sig`));
    const latest = {
      version: manifest.version,
      notes:
        'Reviewed Screen Share Windows release. See the release notes and deployment requirements.',
      pub_date: new Date().toISOString(),
      platforms: {
        'windows-x86_64': {
          signature,
          url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`,
        },
      },
    };
    await writeFile(join(output, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`, {
      flag: 'wx',
    });
    const publicFiles = [name, `${name}.sig`, 'latest.json'];
    const hashes = await Promise.all(
      publicFiles.map(
        async (file) =>
          `${createHash('sha256')
            .update(await readFile(join(output, file)))
            .digest('hex')}  ${file}`,
      ),
    );
    await writeFile(join(output, 'SHA256SUMS'), `${hashes.join('\n')}\n`, { flag: 'wx' });
    await writeFile(
      join(output, 'release-notes.md'),
      `Screen Share ${manifest.version}\n\nUpdater artifacts are signed using the protected Tauri signing key. This is not Windows Authenticode signing.\n\nCommit: ${revision('HEAD')}\n\nBefore publishing this draft, complete hardware/two-PC/security acceptance, verify this installer against the intended updater public key, and review the release configuration. The build does not establish those acceptance results.\n`,
      { flag: 'wx' },
    );
    console.log(
      'Prepared signed update artifacts and checksums for a draft release. No release was published.',
    );
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
