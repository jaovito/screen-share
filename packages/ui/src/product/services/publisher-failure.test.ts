import { expect, it } from 'bun:test';
import { z } from 'zod';
import { ProductApiError } from './product-api';
import { publisherFailureCode } from './publisher-failure';

it('exposes only bounded native codes and HTTP statuses, never arbitrary rejection content', () => {
  expect(publisherFailureCode('authorization_invalid')).toBe('authorization_invalid');
  expect(publisherFailureCode('engine_start_failed')).toBe('engine_start_failed');
  for (const value of [new Error('synthetic private token'), 'private key', null, { token: 'x' }])
    expect(publisherFailureCode(value)).toBe('unexpected_failure');
  expect(publisherFailureCode(new ProductApiError(409))).toBe('control_http_409');
  expect(publisherFailureCode(new ProductApiError(401))).toBe('control_http_401');
  expect(publisherFailureCode(new ProductApiError(999))).toBe('control_http_error');
  expect(publisherFailureCode(new DOMException('private content', 'AbortError'))).toBe(
    'request_aborted',
  );
  const result = z.number().safeParse('private value');
  if (result.success) throw new Error('Expected validation rejection');
  expect(publisherFailureCode(result.error)).toBe('invalid_response');
});
