import {
  adviseQuality,
  appendPublisherSample,
  type PublisherQualitySample,
  publisherQualityEvidence,
} from '@screen-share/diagnostics/quality';
import { useEffect, useState } from 'react';
import { type ProductMessage, useProductMessages } from '../locales';
import type { NativeSharingStatus } from '../types';

const reasonMessages: Record<string, ProductMessage> = {
  source_closed: 'reason_source_closed',
  selection_canceled: 'reason_selection_canceled',
  authorization_failed: 'reason_authorization_failed',
  capture_failed: 'reason_capture_failed',
  encoder_failed: 'reason_encoder_failed',
  transport_failed: 'reason_transport_failed',
  cleanup_failed: 'reason_cleanup_failed',
  lease_expired: 'reason_lease_expired',
  invalid_request: 'reason_invalid_request',
  worker_failed: 'reason_worker_failed',
  engine_missing: 'reason_engine_missing',
  child_unresponsive: 'reason_child_unresponsive',
  stopped_by_user: 'reason_stopped_by_user',
  unsupported_platform: 'reason_unsupported_platform',
};

export function PublisherDiagnostics({ status }: { status: NativeSharingStatus }) {
  const t = useProductMessages();
  const [samples, setSamples] = useState<PublisherQualitySample[]>([]);
  useEffect(() => {
    setSamples((previous) => appendPublisherSample(previous, status));
  }, [status]);
  const current =
    status.state === 'sharing' &&
    samples.at(-1)?.diagnosticsGeneration === status.diagnosticsGeneration &&
    samples.at(-1)?.profileId === status.profileId &&
    samples.at(-1)?.targetFps === status.targetFps
      ? samples
      : [];
  const advice = adviseQuality(publisherQualityEvidence(current));
  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : value.toFixed(1);
  const reason = status.reason
    ? Object.hasOwn(reasonMessages, status.reason)
      ? (reasonMessages[status.reason] ?? 'reason_unknown')
      : 'reason_unknown'
    : null;

  return (
    <>
      {reason && (
        <p className="notice" role="status">
          {t(reason)}
        </p>
      )}
      <details className="diagnostics">
        <summary>{t('diagnostics')}</summary>
        <p role="status">{t(`advice_${advice}`)}</p>
        {status.reason !== 'source_closed' && (
          <p className="notice">{t('sourceActivityUnknown')}</p>
        )}
        <dl>
          <dt>{t('framesCaptured')}</dt>
          <dd>{status.framesCaptured}</dd>
          <dt>{t('framesEncoded')}</dt>
          <dd>{status.framesEncoded}</dd>
          <dt>{t('encodedBytes')}</dt>
          <dd>{status.encodedBytes}</dd>
          <dt>{t('elapsed')}</dt>
          <dd>{Math.floor(status.elapsedMs / 1000)}</dd>
          <dt>{t('captureFps')}</dt>
          <dd>{number(status.captureFps)}</dd>
          <dt>{t('encodedFps')}</dt>
          <dd>{number(status.encodedFps)}</dd>
          <dt>{t('targetFps')}</dt>
          <dd>{number(status.targetFps)}</dd>
          <dt>{t('conversionSubmission')}</dt>
          <dd>{number(status.conversionSubmissionMs)} ms</dd>
          <dt>{t('encoderOutputLatency')}</dt>
          <dd>{number(status.encoderOutputLatencyMs)} ms</dd>
          <dt>{t('availableSendTarget')}</dt>
          <dd>{number(status.availableSendBitrateBps)} bps</dd>
        </dl>
        <p className="notice">{t('processingMetricNotice')}</p>
        <p className="notice">{t('metricNotice')}</p>
      </details>
    </>
  );
}
