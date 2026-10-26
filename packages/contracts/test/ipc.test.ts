import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { appInfoSchema } from '../src/index.js';

it('fixture IPC é compatível com o contrato TypeScript', () => {
  const fixture: unknown = JSON.parse(
    readFileSync(new URL('../fixtures/app-info.json', import.meta.url), 'utf8'),
  );

  expect(appInfoSchema.strict().safeParse(fixture).success).toBe(true);
});
