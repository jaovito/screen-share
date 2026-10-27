import { expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createReportCache } from '@modules/private-rooms/adapters/report-cache';
import type { ReceiverReport } from '@screen-share/contracts';

const metrics = {
  intervalMs: 1000,
  decodedFps: 30,
  inboundBitrateBps: 1_000_000,
  droppedFrames: 0,
  averageDecodeMs: 2,
  packetLossRatio: 0,
  jitterMs: 1,
  transportRttMs: 20,
  width: 1280,
  height: 720,
};
const report = (): ReceiverReport => ({
  sessionId: randomUUID(),
  epoch: 1,
  reportId: randomUUID(),
  sequence: 1,
  metrics: { ...metrics },
});

it('expires private observations on the server clock and rejects reordered or retired streams', () => {
  let now = 0;
  const cache = createReportCache(
    () => now,
    () => 123,
  );
  const first = report();
  expect(cache.put('room', 'viewer', first)).toBe(true);
  expect(cache.put('room', 'viewer', first)).toBe(false);
  expect(cache.put('room', 'viewer', { ...first, sequence: 2 })).toBe(true);
  expect(cache.put('room', 'viewer', { ...first, sequence: 1 })).toBe(false);
  const second = { ...first, reportId: randomUUID() };
  expect(cache.put('room', 'viewer', { ...second, sequence: 2 })).toBe(false);
  expect(cache.put('room', 'viewer', second)).toBe(true);
  expect(cache.put('room', 'viewer', { ...first, sequence: 3 })).toBe(false);
  for (let index = 0; index < 6; index++)
    expect(cache.put('room', 'viewer', { ...second, reportId: randomUUID() })).toBe(true);
  const observed = cache.list('room', first.sessionId, 1);
  expect(observed[0]?.receivedAt).toBe(123);
  expect(observed[0]).not.toHaveProperty('sessionId');
  const firstObserved = observed[0];
  if (!firstObserved) throw new Error('Expected observation');
  firstObserved.metrics.decodedFps = 999;
  expect(cache.list('room', first.sessionId, 1)[0]?.metrics.decodedFps).toBe(30);
  expect(cache.list('room', first.sessionId, 2)).toEqual([]);
  now = 12_000;
  expect(cache.list('room', first.sessionId, 1)).toEqual([]);
  expect(cache.put('room', 'viewer', first)).toBe(true);
  expect(cache.put('room', 'viewer', { ...first, epoch: 2 })).toBe(true);
  expect(cache.list('room', first.sessionId, 1)).toEqual([]);
});

it('bounds each room at seven observations and all rooms at 1024 entries', () => {
  const cache = createReportCache(
    () => 0,
    () => 0,
  );
  const input = report();
  for (let index = 0; index < 9; index++) cache.put('one', String(index), input);
  expect(cache.list('one', input.sessionId, 1)).toHaveLength(7);
  expect(cache.list('one', input.sessionId, 1).some((entry) => entry.userId === '0')).toBe(false);
  for (let index = 0; index < 1024; index++) cache.put(`room-${index}`, 'viewer', input);
  expect(cache.list('one', input.sessionId, 1)).toEqual([]);
  expect(cache.list('room-1023', input.sessionId, 1)).toHaveLength(1);
});
