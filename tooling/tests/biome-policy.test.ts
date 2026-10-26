import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function lintFixture(path: string, source: string) {
  const file = resolve(root, path);
  writeFileSync(file, source, { flag: 'wx' });

  try {
    return spawnSync(
      process.execPath,
      [resolve(root, 'node_modules/@biomejs/biome/bin/biome'), 'lint', file],
      { cwd: root, encoding: 'utf8' },
    );
  } finally {
    unlinkSync(file);
  }
}

it('Biome rejects runtime globals in browser and I/O in domain', () => {
  for (const [path, source] of [
    ['apps/viewer-web/src/app/fixture.ts', 'void process;'],
    ['apps/control-api/src/modules/profiles/domain/fixture.ts', 'fetch("https://example.com");'],
  ] as const) {
    const result = lintFixture(path, source);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('noRestrictedGlobals');
  }
});

it('Biome rejects conditional React hooks with the actual project configuration', () => {
  const result = lintFixture(
    'apps/desktop/src/features/stream-control/pages/ControlPage/biome-fixture.tsx',
    'import { useState } from "react"; export function Fixture({ ready }: { ready: boolean }) { if (ready) useState(0); return null; }',
  );

  expect(result.status).not.toBe(0);
  expect(result.stderr + result.stdout).toContain('useHookAtTopLevel');
});
