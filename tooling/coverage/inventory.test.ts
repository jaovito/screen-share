import { expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { verifyCoverageInventory } from './inventory';

it('rejects runtime sources absent from coverage and accepts type-only modules', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'screen-share-coverage-'));

  try {
    mkdirSync(resolve(root, 'apps/web/src'), { recursive: true });
    mkdirSync(resolve(root, 'packages/contracts/src'), { recursive: true });
    const source = resolve(root, 'apps/web/src/state.ts');
    const report = resolve(root, 'report.json');
    writeFileSync(source, 'export const state = 1;');
    writeFileSync(resolve(root, 'packages/contracts/src/types.ts'), 'export type ID = string;');
    writeFileSync(report, '{}');
    expect(() => verifyCoverageInventory(root, report)).toThrow('Sources missing coverage reports');

    writeFileSync(report, JSON.stringify({ [source]: { lines: { pct: 100 } } }));
    expect(verifyCoverageInventory(root, report)).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
