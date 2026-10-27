import { run } from './lib';
import { withTestDatabase } from './test-database';
import { testSuites } from './test-suites';

await run('bun', ['run', '--filter', '@screen-share/contracts', 'typecheck']);
const files = testSuites(true)
  .flatMap((suite) => suite.files)
  .filter((file) => file.endsWith('.integration.test.ts'));
await withTestDatabase((env) =>
  run('bun', ['test', '--isolate', '--timeout', '15000', ...files], { env }),
);
