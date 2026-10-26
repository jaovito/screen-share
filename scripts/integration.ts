import { run } from './lib.ts';
import { withTestDatabase } from './test-database.ts';

await run('bun', ['run', '--filter', '@screen-share/contracts', 'build']);
await withTestDatabase((env) =>
  run('bun', ['run', '--filter', '@screen-share/control-api', 'test:integration'], { env }),
);
