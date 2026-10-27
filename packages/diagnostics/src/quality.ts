import type { ReceiverMetrics } from './receiver';

export type QualityAdvice =
  | 'insufficientEvidence'
  | 'sourceInactive'
  | 'captureLimited'
  | 'encoderLimited'
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
