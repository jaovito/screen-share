import { expect, it } from 'bun:test';
import { audioSourceSchema, audioSourcesResponseSchema } from '../src';

it('bounds local audio process descriptors and retains opaque exact process creation times', () => {
  const source = {
    processId: 42,
    label: 'Synthetic application',
    creationTime: '134058525230000000',
  };
  expect(
    audioSourcesResponseSchema.parse({ state: 'ready', sources: [source] }).sources[0]
      ?.creationTime,
  ).toBe(source.creationTime);
  for (const descriptor of [
    { ...source, processId: 0 },
    { ...source, processId: 0x1_0000_0000 },
    { ...source, creationTime: '18446744073709551616' },
    { ...source, creationTime: '0' },
    { ...source, label: 'x'.repeat(257) },
  ])
    expect(audioSourceSchema.safeParse(descriptor).success).toBe(false);
  expect(
    audioSourcesResponseSchema.safeParse({ state: 'unavailable', sources: [source] }).success,
  ).toBe(false);
  expect(
    audioSourcesResponseSchema.safeParse({ state: 'ready', sources: [source, source] }).success,
  ).toBe(false);
  expect(
    audioSourcesResponseSchema.safeParse({
      state: 'ready',
      sources: Array.from({ length: 129 }, (_, index) => ({ ...source, processId: index + 1 })),
    }).success,
  ).toBe(false);
  expect(
    audioSourcesResponseSchema.parse({ state: 'unsupported_platform', sources: [] }).sources,
  ).toEqual([]);
});
