import type { PeerReport, RoomSnapshot } from '@screen-share/contracts';
import { useEffect, useRef, useState } from 'react';
import { useProductMessages } from '../locales';
import type { ProductApi } from '../services/product-api';
import type { NativeSharingStatus } from '../types';
import { ReceiverDiagnostics } from './ReceiverDiagnostics';

type Observation = { report: PeerReport; at: number; publisher: NativeSharingStatus | null };

function limited(window: Observation[]) {
  const first = window[0];
  const last = window.at(-1);
  return (
    first &&
    last &&
    last.at - first.at >= 5000 &&
    window.every(({ report, publisher }) => {
      const target = publisher?.targetFps;
      const encoded = publisher?.encodedFps;
      const metrics = report.metrics;
      return (
        publisher?.state === 'sharing' &&
        target !== null &&
        target !== undefined &&
        target > 0 &&
        encoded !== null &&
        encoded !== undefined &&
        encoded >= target * 0.9 &&
        metrics.decodedFps !== null &&
        metrics.decodedFps < encoded * 0.8 &&
        ((metrics.averageDecodeMs !== null && metrics.averageDecodeMs > 1000 / target) ||
          (metrics.packetLossRatio !== null && metrics.packetLossRatio > 0.03))
      );
    })
  );
}

export function PeerReportsPanel({
  api,
  snapshot,
  publisherStatus,
}: {
  api: ProductApi;
  snapshot: RoomSnapshot;
  publisherStatus: NativeSharingStatus | null;
}) {
  const t = useProductMessages();
  const [reports, setReports] = useState<Array<{ report: PeerReport; limited: boolean }>>([]);
  const [failed, setFailed] = useState(false);
  const publisher = useRef(publisherStatus);
  publisher.current = publisherStatus;
  const roomId = snapshot.room.id;
  const sessionId = snapshot.session?.id;
  const epoch = snapshot.session?.epoch;
  const enabled =
    snapshot.room.membership === 'owner' &&
    snapshot.room.state === 'active' &&
    snapshot.session?.state === 'active';

  useEffect(() => {
    setReports([]);
    setFailed(false);
    if (!enabled || !sessionId || !epoch) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    const history = new Map<string, Observation[]>();
    async function poll() {
      request = new AbortController();
      const deadline = setTimeout(() => request?.abort(), 2000);
      try {
        const response = await api.peerReports(roomId, request.signal);
        if (stopped || request.signal.aborted) return;
        if (response.sessionId !== sessionId || response.epoch !== epoch)
          throw new Error('Stale diagnostic binding');
        const now = performance.now();
        const next = response.reports.map((report) => {
          let window = (history.get(report.userId) ?? []).filter((entry) => now - entry.at <= 8000);
          const previous = window.at(-1)?.report;
          if (previous?.reportId !== report.reportId) window = [];
          if (previous?.reportId !== report.reportId || previous.sequence !== report.sequence)
            window.push({ report, at: now, publisher: publisher.current });
          history.set(report.userId, window);
          return { report, limited: !!limited(window) };
        });
        for (const userId of history.keys())
          if (!next.some((entry) => entry.report.userId === userId)) history.delete(userId);
        setReports(next);
        setFailed(false);
      } catch {
        if (!stopped) {
          setReports([]);
          setFailed(true);
          history.clear();
        }
      } finally {
        clearTimeout(deadline);
        if (!stopped)
          timer = setTimeout(() => {
            void poll();
          }, 3000);
      }
    }
    const offline = () => {
      stopped = true;
      clearTimeout(timer);
      request?.abort();
      history.clear();
      setReports([]);
      setFailed(true);
    };
    window.addEventListener('offline', offline);
    void poll();
    return () => {
      stopped = true;
      request?.abort();
      clearTimeout(timer);
      window.removeEventListener('offline', offline);
    };
  }, [api, enabled, roomId, sessionId, epoch]);

  if (!enabled) return null;
  return (
    <section className="peer-reports" aria-label={t('peerReports')}>
      <h3>{t('peerReports')}</h3>
      <p className="notice">{t('peerReportNotice')}</p>
      {failed && <p role="status">{t('peerReportsUnavailable')}</p>}
      {!failed && reports.length === 0 && <p>{t('peerReportsEmpty')}</p>}
      {reports.map(({ report, limited }) => (
        <article key={report.userId}>
          <h4>{snapshot.members.find((entry) => entry.userId === report.userId)?.name ?? '—'}</h4>
          <ReceiverDiagnostics metrics={report.metrics} />
          {limited && <p className="notice">{t('peerPossiblyLimited')}</p>}
        </article>
      ))}
    </section>
  );
}
