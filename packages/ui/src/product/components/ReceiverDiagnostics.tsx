import type { ReceiverMetrics } from '@screen-share/diagnostics';
import { useProductMessages } from '../locales';

export function ReceiverDiagnostics({ metrics }: { metrics: ReceiverMetrics }) {
  const t = useProductMessages();
  const number = (value: number | null, fraction = 1) =>
    value === null ? '—' : value.toFixed(fraction);

  return (
    <details className="diagnostics">
      <summary>{t('receiverDiagnostics')}</summary>
      <dl>
        <dt>{t('decodedFps')}</dt>
        <dd>{number(metrics.decodedFps)}</dd>
        <dt>{t('inboundBitrate')}</dt>
        <dd>
          {number(
            metrics.inboundBitrateBps === null ? null : metrics.inboundBitrateBps / 1_000_000,
          )}{' '}
          Mbps
        </dd>
        <dt>{t('droppedFrames')}</dt>
        <dd>{number(metrics.droppedFrames, 0)}</dd>
        <dt>{t('averageDecode')}</dt>
        <dd>{number(metrics.averageDecodeMs)} ms</dd>
        <dt>{t('packetLoss')}</dt>
        <dd>{number(metrics.packetLossRatio === null ? null : metrics.packetLossRatio * 100)}%</dd>
        <dt>{t('jitter')}</dt>
        <dd>{number(metrics.jitterMs)} ms</dd>
        <dt>{t('transportRtt')}</dt>
        <dd>{number(metrics.transportRttMs)} ms</dd>
        <dt>{t('dimensions')}</dt>
        <dd>
          {metrics.width ?? '—'} × {metrics.height ?? '—'}
        </dd>
      </dl>
      <p className="notice">{t('receiverMetricNotice')}</p>
    </details>
  );
}
