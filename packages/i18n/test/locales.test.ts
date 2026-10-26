import { expect, it } from 'bun:test';
import { isLocale, readLocale } from '../src/locales.ts';

it('allows only canonical supported locales and defaults safely without browser storage', () => {
  for (const locale of ['pt-BR', 'es', 'en']) expect(isLocale(locale)).toBe(true);
  for (const locale of ['fr', 'pt', 'pt-br', '', '<script>']) expect(isLocale(locale)).toBe(false);
  expect(readLocale()).toBe('pt-BR');
});
