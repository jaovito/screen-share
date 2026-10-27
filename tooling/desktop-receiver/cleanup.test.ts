import { expect, it } from 'bun:test';
import { finalizeFixture } from './cleanup';

it('awaits every cleanup in order after a successful fixture', async () => {
  const released: string[] = [];
  await finalizeFixture(undefined, [
    async () => {
      await Promise.resolve();
      released.push('browser');
    },
    () => released.push('server'),
    () => released.push('directory'),
  ]);
  expect(released).toEqual(['browser', 'server', 'directory']);
});

it('retains the original failure when later cleanup also fails and releases the other owners', async () => {
  const original = new Error('Playback failed');
  const cleanup = new Error('Directory remained locked');
  let stopped = false;
  try {
    await finalizeFixture(original, [
      () => {
        throw cleanup;
      },
      async () => {
        stopped = true;
      },
    ]);
    throw new Error('Fixture failure was swallowed');
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw error;
    expect(error.cause).toBe(original);
    expect(error.errors).toEqual([original, cleanup]);
  }
  expect(stopped).toBe(true);
});

it('propagates the original failure unchanged when cleanup succeeds', async () => {
  const original = new Error('Publisher failed');
  await expect(finalizeFixture(original, [() => {}])).rejects.toBe(original);
});

it('fails a successful fixture on cleanup failure instead of reporting a false pass', async () => {
  const cleanup = new Error('Owned process did not close');
  await expect(
    finalizeFixture(undefined, [
      async () => {
        throw cleanup;
      },
    ]),
  ).rejects.toBe(cleanup);
});
