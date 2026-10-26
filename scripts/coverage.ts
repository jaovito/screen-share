import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeCoverageReport } from '../tooling/coverage/report.ts';
import { root, run } from './lib.ts';
import { withTestDatabase } from './test-database.ts';
import { runTestSuites } from './test-suites.ts';

await rm(resolve(root, 'coverage'), { recursive: true, force: true });
await run('bun', ['run', '--filter', '@screen-share/contracts', 'build']);
await withTestDatabase((env) => runTestSuites({ database: true, coverage: true, env }));

writeCoverageReport(root, ['server', 'frontend']);
