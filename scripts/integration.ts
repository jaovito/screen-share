import { run } from './lib';
import { withTestDatabase } from './test-database';

await run('bun', ['run', '--filter', '@screen-share/contracts', 'typecheck']);
await withTestDatabase((env) =>
  run('bun', ['run', '--filter', '@screen-share/control-api', 'test:integration'], { env }),
);
