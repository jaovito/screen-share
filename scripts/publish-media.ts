import { resolve } from 'node:path';
import { root, run } from './lib';

if (process.platform !== 'win32')
  throw new Error('The explicit native publishing proof requires Windows 11.');

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const buildEnv = { ...process.env };
for (const name of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'DATABASE_URL', 'POSTGRES_PASSWORD'])
  delete buildEnv[name];

await run('cargo', ['build', '--locked', '-p', 'ss-media-proof', '--features', 'native-proof'], {
  env: {
    ...buildEnv,
    CARGO_BUILD_JOBS: '2',
    CMAKE_BUILD_PARALLEL_LEVEL: '2',
    RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} -C target-feature=+crt-static`.trim(),
  },
});
const runtimeEnv: NodeJS.ProcessEnv = { RUST_BACKTRACE: '0' };
for (const name of [
  'PATH',
  'Path',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
]) {
  if (process.env[name]) runtimeEnv[name] = process.env[name];
}
await run(resolve(root, 'target/debug/ss-media-proof.exe'), args, { env: runtimeEnv });
