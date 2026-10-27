export type ReceiverBaseline = {
  id: string;
  timestamp: number;
  frames: number | null;
  dropped: number | null;
  bytes: number | null;
  decodeSeconds: number | null;
  packets: number | null;
  lost: number | null;
};

export type ReceiverMetrics = {
  intervalMs: number;
  decodedFps: number | null;
  inboundBitrateBps: number | null;
  droppedFrames: number | null;
  averageDecodeMs: number | null;
  packetLossRatio: number | null;
  jitterMs: number | null;
  transportRttMs: number | null;
  width: number | null;
  height: number | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function counter(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function delta(next: number | null, previous: number | null): number | null {
  return next !== null && previous !== null && next >= previous ? next - previous : null;
}

/** Counter deltas stay on one inbound stream. First/reset/invalid samples are unavailable. */
export function receiverSample(
  reports: Iterable<unknown>,
  previous?: ReceiverBaseline,
): { baseline?: ReceiverBaseline; metrics: ReceiverMetrics | null } {
  const values = Array.from(reports, record).filter((value) => value !== null);
  const inbound = values.find(
    (value) =>
      value.type === 'inbound-rtp' &&
      (value.kind === 'video' || value.mediaType === 'video') &&
      value.isRemote !== true &&
      typeof value.id === 'string' &&
      counter(value.timestamp) !== null,
  );

  if (!inbound || typeof inbound.id !== 'string' || typeof inbound.timestamp !== 'number')
    return { metrics: null };

  const baseline: ReceiverBaseline = {
    id: inbound.id,
    timestamp: inbound.timestamp,
    frames: counter(inbound.framesDecoded),
    dropped: counter(inbound.framesDropped),
    bytes: counter(inbound.bytesReceived),
    decodeSeconds: counter(inbound.totalDecodeTime),
    packets: counter(inbound.packetsReceived),
    lost: counter(inbound.packetsLost),
  };
  const intervalMs = previous ? baseline.timestamp - previous.timestamp : 0;

  if (!previous || previous.id !== baseline.id || intervalMs <= 0 || intervalMs > 10_000)
    return { baseline, metrics: null };

  const frames = delta(baseline.frames, previous.frames);
  const bytes = delta(baseline.bytes, previous.bytes);
  const decoded = delta(baseline.decodeSeconds, previous.decodeSeconds);
  const lost = delta(baseline.lost, previous.lost);
  const received = delta(baseline.packets, previous.packets);
  const pair = values.find(
    (value) =>
      value.type === 'candidate-pair' && value.nominated === true && value.state === 'succeeded',
  );
  const rtt = counter(pair?.currentRoundTripTime);
  const jitter = counter(inbound.jitter);

  return {
    baseline,
    metrics: {
      intervalMs,
      decodedFps: frames === null ? null : (frames * 1000) / intervalMs,
      inboundBitrateBps: bytes === null ? null : (bytes * 8000) / intervalMs,
      droppedFrames: delta(baseline.dropped, previous.dropped),
      averageDecodeMs:
        decoded !== null && frames !== null && frames > 0 ? (decoded * 1000) / frames : null,
      packetLossRatio:
        lost !== null && received !== null && lost + received > 0 ? lost / (lost + received) : null,
      jitterMs: jitter === null ? null : jitter * 1000,
      transportRttMs: rtt === null ? null : rtt * 1000,
      width: counter(inbound.frameWidth),
      height: counter(inbound.frameHeight),
    },
  };
}
