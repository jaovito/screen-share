import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { root, run } from './lib';

const api = join(root, 'apps/control-api');
const output = join(api, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await run(
  'bun',
  [
    'build',
    '--compile',
    '--minify',
    '--no-compile-autoload-dotenv',
    '--no-compile-autoload-bunfig',
    '--asset',
    './drizzle',
    './src/index.ts',
    '--outfile',
    join(output, 'control-api'),
  ],
  { cwd: api },
);
