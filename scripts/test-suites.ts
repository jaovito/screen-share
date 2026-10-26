import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, run } from './lib.ts';

export type TestSuite = { name: string; files: string[]; preload?: string };

function testsIn(directory: string) {
  return readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })
    .map((name) => `${directory}/${name.replaceAll('\\', '/')}`)
    .filter((name) => /\.test\.tsx?$/.test(name) && !/\/(node_modules|dist)\//.test(name))
    .map((name) => `./${name}`);
}

export function testSuites(database = false): TestSuite[] {
  const nodeFiles = [
    ...testsIn('packages'),
    ...testsIn('tooling'),
    ...testsIn('apps/control-api/test'),
  ].filter((name) => database || !name.endsWith('.integration.test.ts'));

  return [
    { name: 'server', files: nodeFiles },
    {
      name: 'frontend',
      files: [...testsIn('apps/viewer-web/src'), ...testsIn('apps/desktop/src')],
      preload: './tooling/tests/setup-dom.ts',
    },
  ];
}

export async function runTestSuites(
  options: { database?: boolean; coverage?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  for (const suite of testSuites(options.database)) {
    const args = ['test', '--isolate', '--timeout', '15000'];
    if (suite.preload) args.push('--preload', suite.preload);
    if (options.coverage)
      args.push(
        '--coverage',
        '--coverage-reporter=text',
        '--coverage-reporter=lcov',
        `--coverage-dir=coverage/${suite.name}`,
      );

    await run('bun', [...args, ...suite.files], { env: options.env ?? process.env });
  }
}
