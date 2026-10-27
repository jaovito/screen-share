import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { appInfoSchema } from '../src/index';

it('IPC fixture is compatible with the TypeScript contract', () => {
  const fixture: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/app-info.json', import.meta.url), 'utf8'),
  );

  expect(appInfoSchema.strict().safeParse(fixture).success).toBe(true);
});
