import { expect, it } from 'bun:test';
import { generateMediaKey } from './media-key';

it('creates independent canonical media keys without publishing or persisting them', () => {
  const previous = globalThis.isSecureContext;
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  const first = generateMediaKey();
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(generateMediaKey()).not.toBe(first);
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
  expect(() => generateMediaKey()).toThrow('randomness unavailable');
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: previous });
});
