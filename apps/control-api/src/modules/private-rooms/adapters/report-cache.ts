import type { PeerReport, ReceiverReport } from '@screen-share/contracts';
import type { ReportCache } from '../application/report-port';

type Entry = {
  roomId: string;
  sessionId: string;
  epoch: number;
  expires: number;
  report: PeerReport;
  retired: string[];
};

/** Process-local advisory observations. Restart/eviction intentionally loses reports. */
export function createReportCache(
  clock = () => performance.now(),
  wallClock = Date.now,
): ReportCache {
  const entries = new Map<string, Entry>();
  function purge(now: number) {
    for (const [key, value] of entries) if (value.expires <= now) entries.delete(key);
  }
  return {
    put(roomId: string, actor: string, input: ReceiverReport) {
      const now = clock();
      purge(now);
      const key = `${roomId}:${actor}`;
      const previous = entries.get(key);
      const sameBinding = previous?.sessionId === input.sessionId && previous.epoch === input.epoch;
      const retired = sameBinding ? previous.retired : [];
      if (sameBinding) {
        if (previous.report.reportId === input.reportId) {
          if (input.sequence <= previous.report.sequence) return false;
        } else {
          if (input.sequence !== 1 || retired.includes(input.reportId)) return false;
          retired.push(previous.report.reportId);
          if (retired.length > 4) retired.shift();
        }
      }
      if (!previous) {
        const roomKeys = [...entries].filter(([, value]) => value.roomId === roomId);
        if (roomKeys.length >= 7) entries.delete(roomKeys[0]?.[0] ?? '');
        if (entries.size >= 1024) {
          const oldest = entries.keys().next().value;
          if (oldest) entries.delete(oldest);
        }
      }
      entries.delete(key);
      entries.set(key, {
        roomId,
        sessionId: input.sessionId,
        epoch: input.epoch,
        expires: now + 12_000,
        retired,
        report: {
          userId: actor,
          reportId: input.reportId,
          sequence: input.sequence,
          receivedAt: wallClock(),
          metrics: { ...input.metrics },
        },
      });
      return true;
    },
    list(roomId, sessionId, epoch) {
      purge(clock());
      return [...entries.values()]
        .filter(
          (value) =>
            value.roomId === roomId && value.sessionId === sessionId && value.epoch === epoch,
        )
        .map((value) => ({ ...value.report, metrics: { ...value.report.metrics } }));
    },
  };
}
