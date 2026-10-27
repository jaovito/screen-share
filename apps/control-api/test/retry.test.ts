import { afterEach, expect, it, jest, mock } from 'bun:test';
import { retryDatabase } from '@modules/system/adapters/postgres';

afterEach(() => jest.useRealTimers());

it('retries transient failures with bounded backoff and then succeeds', async () => {
  jest.useFakeTimers();

  const check = mock().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const result = retryDatabase(check);

  await Promise.resolve();
  jest.runAllTimers();
  await result;
  expect(check).toHaveBeenCalledTimes(2);
});

it('rejects after the configured maximum instead of retrying forever', async () => {
  const check = mock().mockRejectedValue(new Error('private detail'));

  await expect(retryDatabase(check, 1)).rejects.toThrow(
    'Banco indisponível após tentativas limitadas',
  );
  expect(check).toHaveBeenCalledTimes(1);
});
