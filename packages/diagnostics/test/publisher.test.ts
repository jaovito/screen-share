import { expect, it } from 'bun:test';
import {
  adviseQuality,
  appendPublisherSample,
  type PublisherQualitySample,
  publisherQualityEvidence,
} from '../src/quality';

function sample(
  at: number,
  overrides: Partial<PublisherQualitySample> = {},
): PublisherQualitySample {
  return {
    state: 'sharing',
    profileId: '1080p60',
    diagnosticsGeneration: 1,
    diagnosticsElapsedMs: at,
    targetFps: 60,
    captureFps: 60,
    encodedFps: 20,
    encoderOutputLatencyMs: 40,
    availableSendBitrateBps: 10_000_000,
    manualBitrateBps: 10_000_000,
    ...overrides,
  };
}

it('requires uninterrupted generation-bound observations before describing combined output pressure', () => {
  let samples: PublisherQualitySample[] = [];
  for (let at = 0; at <= 5000; at += 1000) samples = appendPublisherSample(samples, sample(at));
  expect(adviseQuality(publisherQualityEvidence(samples))).toBe('processingLimited');
  expect(publisherQualityEvidence(samples).sourceActive).toBeUndefined();
  expect(appendPublisherSample(samples, sample(5000))).toBe(samples);
  for (const invalid of [
    sample(6000, { state: 'paused' }),
    sample(6000, { diagnosticsGeneration: undefined }),
    sample(6000, { diagnosticsElapsedMs: undefined }),
  ])
    expect(appendPublisherSample(samples, invalid)).toEqual([]);
  for (const restart of [
    sample(6000, { diagnosticsGeneration: 2 }),
    sample(1000),
    sample(9000),
    sample(6000, { profileId: '720p60' }),
    sample(6000, { targetFps: 30 }),
  ]) {
    const reset = appendPublisherSample(samples, restart);
    expect(reset).toEqual([restart]);
    expect(adviseQuality(publisherQualityEvidence(reset))).toBe('insufficientEvidence');
  }
});

it('bounds local evidence and keeps absent timing, source activity and stale transport targets unavailable', () => {
  let samples: PublisherQualitySample[] = [];
  for (let at = 0; at <= 20_000; at += 100) samples = appendPublisherSample(samples, sample(at));
  expect(samples).toHaveLength(16);
  const missing = publisherQualityEvidence([
    sample(0, { encoderOutputLatencyMs: null, captureFps: null, encodedFps: null }),
    sample(6000, { availableSendBitrateBps: null, manualBitrateBps: null }),
  ]);
  expect(missing.processingLatencyMs).toBeUndefined();
  expect(missing.capturedFps).toBeUndefined();
  expect(missing.encodedFps).toBeUndefined();
  expect(missing.availableSendBitrateBps).toBeUndefined();
  expect(missing.targetBitrateBps).toBeUndefined();
  expect(adviseQuality(missing)).toBe('insufficientEvidence');
  expect(adviseQuality(publisherQualityEvidence([]))).toBe('insufficientEvidence');
  const lowCadence = publisherQualityEvidence([
    sample(0, { captureFps: 1 }),
    sample(5000, { captureFps: 1 }),
  ]);
  expect(adviseQuality(lowCadence)).toBe('insufficientEvidence');
  const network = publisherQualityEvidence([
    sample(0, { availableSendBitrateBps: 1_000_000 }),
    sample(5000, { availableSendBitrateBps: 1_000_000 }),
  ]);
  expect(adviseQuality({ ...network, processingLatencyMs: 1 })).toBe('uploadLimited');
});
