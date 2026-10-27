import { afterEach, expect, it, jest, mock, spyOn } from 'bun:test';
import type { RoomSnapshot } from '@screen-share/contracts';
import { act, render } from '@testing-library/react';
import { sessionId, snapshot } from '../fixtures.test';
import type { ProductApi } from '../services/product-api';
import { createProductApi } from '../services/product-api';
import { useReceiverReports } from './use-receiver-reports';

function Harness({
  api,
  room,
  receive,
}: {
  api: ProductApi;
  room: RoomSnapshot;
  receive(actions: ReturnType<typeof useReceiverReports>): void;
}) {
  receive(useReceiverReports(api, room));
  return null;
}

const metrics = {
  intervalMs: 1000,
  decodedFps: 30,
  inboundBitrateBps: 1_000_000,
  droppedFrames: 0,
  averageDecodeMs: 4,
  packetLossRatio: 0,
  jitterMs: 1,
  transportRttMs: 20,
  width: 1280,
  height: 720,
};
async function flush() {
  await act(async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
  });
}
afterEach(() => {
  jest.useRealTimers();
  mock.restore();
});

it('sends fresh private metrics without overlap, resets stream identity and aborts on stop or unmount', async () => {
  jest.useFakeTimers();
  let now = 0;
  spyOn(performance, 'now').mockImplementation(() => now);
  const room = snapshot();
  room.session = {
    id: sessionId,
    epoch: 1,
    membershipRevision: 1,
    publisherId: room.room.ownerId,
    state: 'active',
    createdAt: room.room.createdAt,
  };
  const calls: Array<{ body?: object; signal: AbortSignal }> = [];
  let pending = false;
  const api = createProductApi('https://control.example.test', async (input) => {
    calls.push(input);
    if (pending)
      await new Promise((_, reject) => {
        input.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    return { status: 200, body: { accepted: true } };
  });
  let actions: ReturnType<typeof useReceiverReports> | undefined;
  const view = render(
    <Harness
      api={api}
      room={room}
      receive={(value) => {
        actions = value;
      }}
    />,
  );
  await flush();
  if (!actions) throw new Error('Expected report controls');
  actions.sample(metrics);
  now = 3000;
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(calls).toHaveLength(0);
  actions.reset();
  now = 4000;
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  actions.sample(metrics);
  now = 6000;
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  await flush();
  expect(calls).toHaveLength(1);
  expect(calls[0]?.body).not.toHaveProperty('userId');
  const first = calls[0]?.body;
  actions.reset();
  pending = true;
  now = 7000;
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  actions.sample(metrics);
  now = 9000;
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  await flush();
  expect(calls).toHaveLength(2);
  expect(calls[1]?.body).not.toEqual(first);
  actions.stop();
  expect(calls[1]?.signal.aborted).toBe(true);
  now = 19000;
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
  expect(calls).toHaveLength(2);
  actions.reset();
  actions.sample({ ...metrics, intervalMs: 0, decodedFps: null });
  view.unmount();
  expect(calls[1]?.signal.aborted).toBe(true);
});
