import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeCoverageReport } from '../tooling/coverage/report';
import { root, run } from './lib';
import { withTestDatabase } from './test-database';
import { runTestSuites } from './test-suites';

await rm(resolve(root, 'coverage'), { recursive: true, force: true });
await run('bun', ['run', '--filter', '@screen-share/contracts', 'typecheck']);
await withTestDatabase((env) => runTestSuites({ database: true, coverage: true, env }));

writeCoverageReport(root, ['server', 'frontend']);
