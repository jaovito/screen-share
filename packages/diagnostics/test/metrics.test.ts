import { describe, expect, it } from 'bun:test';
import { adviseQuality, type ReceiverMetrics, receiverSample } from '../src';

function report(timestamp = 1000, frames = 10, bytes = 10000) {
  return {
    id: 'stream',
    type: 'inbound-rtp',
    kind: 'video',
    timestamp,
    framesDecoded: frames,
    bytesReceived: bytes,
    framesDropped: 2,
    totalDecodeTime: frames * 0.002,
    packetsLost: 1,
    packetsReceived: 100,
    jitter: 0.01,
    frameWidth: 1280,
    frameHeight: 720,
  };
}

describe('receiver counter evidence', () => {
  it('uses deltas on the same stream and distinguishes transport RTT from visual latency', () => {
    const baseline = receiverSample([null, 'invalid', report()]).baseline;
    const sample = receiverSample(
      [
        report(2000, 40, 20000),
        { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.02 },
      ],
      baseline,
    );
    expect(sample.metrics).toEqual({
      intervalMs: 1000,
      decodedFps: 30,
      inboundBitrateBps: 80000,
      droppedFrames: 0,
      averageDecodeMs: 2,
      packetLossRatio: null,
      jitterMs: 10,
      transportRttMs: 20,
      width: 1280,
      height: 720,
    });
    expect(
      receiverSample([{ ...report(3000), packetsLost: 2, packetsReceived: 199 }], sample.baseline)
        .metrics?.packetLossRatio,
    ).toBe(0.01);
  });

  it('resets first, changed, invalid, late and nonmonotonic samples without manufacturing counters', () => {
    const baseline = receiverSample([report()]).baseline;
    expect(receiverSample([]).metrics).toBeNull();
    for (const value of [
      report(),
      { ...report(), id: 'another' },
      report(999),
      report(20000),
      { ...report(), timestamp: NaN },
    ]) {
      expect(receiverSample([value], baseline).metrics).toBeNull();
    }
    const reset = receiverSample(
      [{ ...report(2000, 1, 1), jitter: -1, packetsReceived: -1, totalDecodeTime: -1 }],
      baseline,
    ).metrics;
    expect(reset?.decodedFps).toBeNull();
    expect(reset?.inboundBitrateBps).toBeNull();
    expect(reset?.averageDecodeMs).toBeNull();
    expect(reset?.jitterMs).toBeNull();
    expect(reset?.packetLossRatio).toBeNull();
    const empty = receiverSample(
      [{ id: 'stream', type: 'inbound-rtp', mediaType: 'video', timestamp: 2000 }],
      baseline,
    ).metrics;
    expect(empty?.transportRttMs).toBeNull();
    expect(empty?.width).toBeNull();
  });
});

describe('explainable quality advice', () => {
  const receiver: ReceiverMetrics = {
    intervalMs: 1000,
    decodedFps: 60,
    inboundBitrateBps: 6000000,
    droppedFrames: 0,
    averageDecodeMs: 2,
    packetLossRatio: 0,
    jitterMs: 10,
    transportRttMs: 20,
    width: 1920,
    height: 1080,
  };
  const evidence = { targetFps: 60, observationMs: 10000 };

  it('does not interpret static scenes, short windows or unavailable measurements as a freeze', () => {
    expect(adviseQuality({ ...evidence, observationMs: 1000 })).toBe('insufficientEvidence');
    expect(adviseQuality({ ...evidence, targetFps: NaN })).toBe('insufficientEvidence');
    expect(adviseQuality({ ...evidence, targetFps: 0 })).toBe('insufficientEvidence');
    expect(adviseQuality(evidence)).toBe('insufficientEvidence');
    expect(adviseQuality({ ...evidence, sourceActive: false, capturedFps: 0 })).toBe(
      'sourceInactive',
    );
  });

  it('separates capture, measured encoder time, send headroom and receiver limitations', () => {
    expect(adviseQuality({ ...evidence, sourceActive: true, capturedFps: 20 })).toBe(
      'captureLimited',
    );
    expect(
      adviseQuality({ ...evidence, capturedFps: 60, encodedFps: 20, averageEncodeMs: 30 }),
    ).toBe('encoderLimited');
    expect(adviseQuality({ ...evidence, capturedFps: 60, encodedFps: 20 })).toBe(
      'insufficientEvidence',
    );
    expect(
      adviseQuality({ ...evidence, targetBitrateBps: 10000000, availableSendBitrateBps: 1000000 }),
    ).toBe('uploadLimited');
    expect(
      adviseQuality({
        ...evidence,
        encodedFps: 60,
        receiver: { ...receiver, decodedFps: 20, averageDecodeMs: 30 },
      }),
    ).toBe('receiverLimited');
    expect(
      adviseQuality({
        ...evidence,
        encodedFps: 60,
        receiver: { ...receiver, decodedFps: 20, packetLossRatio: 0.1 },
      }),
    ).toBe('receiverLimited');
    expect(
      adviseQuality({
        ...evidence,
        sourceActive: true,
        capturedFps: 60,
        averageEncodeMs: 2,
        encodedFps: 60,
        receiver,
      }),
    ).toBe('healthy');
  });
});
