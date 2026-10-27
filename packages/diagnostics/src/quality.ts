import type { ReceiverMetrics } from './receiver';

export type QualityAdvice =
  | 'insufficientEvidence'
  | 'sourceInactive'
  | 'captureLimited'
  | 'encoderLimited'
  | 'processingLimited'
  | 'uploadLimited'
  | 'receiverLimited'
  | 'healthy';

export type QualityEvidence = {
  targetFps: number;
  observationMs: number;
  sourceActive?: boolean;
  capturedFps?: number;
  encodedFps?: number;
  averageEncodeMs?: number;
  processingLatencyMs?: number;
  targetBitrateBps?: number;
  availableSendBitrateBps?: number;
  receiver?: ReceiverMetrics;
};

function measured(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

/** Explain only stages with evidence. Static scenes and missing counters are not freezes. */
export function adviseQuality(evidence: QualityEvidence): QualityAdvice {
  const {
    targetFps,
    sourceActive,
    capturedFps,
    encodedFps,
    averageEncodeMs,
    processingLatencyMs,
    targetBitrateBps,
    availableSendBitrateBps,
    receiver,
  } = evidence;
  if (
    !measured(targetFps) ||
    targetFps <= 0 ||
    !measured(evidence.observationMs) ||
    evidence.observationMs < 5000
  )
    return 'insufficientEvidence';
  if (sourceActive === false) return 'sourceInactive';
  if (sourceActive === true && measured(capturedFps) && capturedFps < targetFps * 0.8)
    return 'captureLimited';
  if (
    measured(capturedFps) &&
    measured(encodedFps) &&
    capturedFps >= targetFps * 0.9 &&
    encodedFps < targetFps * 0.8 &&
    measured(processingLatencyMs) &&
    processingLatencyMs > 1000 / targetFps
  )
    return 'processingLimited';
  if (
    measured(capturedFps) &&
    measured(encodedFps) &&
    capturedFps >= targetFps * 0.9 &&
    encodedFps < targetFps * 0.8 &&
    measured(averageEncodeMs) &&
    averageEncodeMs > 1000 / targetFps
  )
    return 'encoderLimited';
  if (
    measured(targetBitrateBps) &&
    measured(availableSendBitrateBps) &&
    availableSendBitrateBps < targetBitrateBps * 0.8
  )
    return 'uploadLimited';
  if (
    receiver &&
    measured(encodedFps) &&
    encodedFps >= targetFps * 0.9 &&
    receiver.decodedFps !== null &&
    receiver.decodedFps < encodedFps * 0.8 &&
    ((receiver.averageDecodeMs !== null && receiver.averageDecodeMs > 1000 / targetFps) ||
      (receiver.packetLossRatio !== null && receiver.packetLossRatio > 0.03))
  )
    return 'receiverLimited';
  if (
    sourceActive === true &&
    measured(capturedFps) &&
    capturedFps >= targetFps * 0.95 &&
    measured(averageEncodeMs) &&
    averageEncodeMs <= 1000 / targetFps &&
    measured(encodedFps) &&
    encodedFps >= targetFps * 0.95 &&
    receiver?.decodedFps !== null &&
    receiver?.decodedFps !== undefined &&
    receiver.decodedFps >= targetFps * 0.95
  )
    return 'healthy';
  return 'insufficientEvidence';
}

/** Native elapsed time resets with the actual processing/transport generation. */
export type PublisherQualitySample = {
  state: string;
  profileId: string | null;
  diagnosticsGeneration?: number | undefined;
  diagnosticsElapsedMs?: number | undefined;
  targetFps: number | null;
  captureFps: number | null;
  encodedFps: number | null;
  encoderOutputLatencyMs?: number | null | undefined;
  availableSendBitrateBps?: number | null | undefined;
  manualBitrateBps?: number | null | undefined;
};

/** Keep evidence local, bounded, and strictly within one uninterrupted stream. */
export function appendPublisherSample(
  previous: PublisherQualitySample[],
  sample: PublisherQualitySample,
): PublisherQualitySample[] {
  if (
    sample.state !== 'sharing' ||
    !measured(sample.diagnosticsGeneration) ||
    !measured(sample.diagnosticsElapsedMs)
  )
    return [];
  const last = previous.at(-1);
  const elapsed = sample.diagnosticsElapsedMs;
  const gap = elapsed - (last?.diagnosticsElapsedMs ?? elapsed);
  if (
    last &&
    last.diagnosticsGeneration === sample.diagnosticsGeneration &&
    last.profileId === sample.profileId &&
    last.targetFps === sample.targetFps &&
    gap === 0
  )
    return previous;
  const continuous =
    last &&
    last.diagnosticsGeneration === sample.diagnosticsGeneration &&
    last.profileId === sample.profileId &&
    last.targetFps === sample.targetFps &&
    gap > 0 &&
    gap <= 2500;
  const history = continuous ? previous : [];
  return [
    ...history.filter((entry) => elapsed - (entry.diagnosticsElapsedMs ?? 0) <= 8000),
    sample,
  ].slice(-16);
}

export function publisherQualityEvidence(samples: PublisherQualitySample[]): QualityEvidence {
  const first = samples[0];
  const last = samples.at(-1);
  const evidence: QualityEvidence = {
    targetFps: last?.targetFps ?? 0,
    observationMs: (last?.diagnosticsElapsedMs ?? 0) - (first?.diagnosticsElapsedMs ?? 0),
  };
  const average = (values: Array<number | null | undefined>) =>
    values.length && values.every((value) => measured(value ?? undefined))
      ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / values.length
      : undefined;
  const captured = average(samples.map((sample) => sample.captureFps));
  const encoded = average(samples.map((sample) => sample.encodedFps));
  const processing = average(samples.map((sample) => sample.encoderOutputLatencyMs));
  const available = average(samples.map((sample) => sample.availableSendBitrateBps));
  if (captured !== undefined) evidence.capturedFps = captured;
  if (encoded !== undefined) evidence.encodedFps = encoded;
  if (processing !== undefined) evidence.processingLatencyMs = processing;
  if (available !== undefined) evidence.availableSendBitrateBps = available;
  if (last?.manualBitrateBps !== undefined && last.manualBitrateBps !== null)
    evidence.targetBitrateBps = last.manualBitrateBps;
  // WGC cadence does not reveal source activity. Never manufacture that evidence.
  return evidence;
}
