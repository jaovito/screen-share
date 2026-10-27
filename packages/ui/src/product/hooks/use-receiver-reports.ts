import type { RoomSnapshot } from '@screen-share/contracts';
import { receiverMetricsSchema } from '@screen-share/contracts';
import type { ReceiverMetrics } from '@screen-share/diagnostics';
import { useEffect, useMemo, useRef } from 'react';
import type { ProductApi } from '../services/product-api';

/** Only fresh numeric observations leave this client, never SDK stats identifiers. */
export function useReceiverReports(api: ProductApi, snapshot: RoomSnapshot) {
  const sessionId = snapshot.session?.id;
  const epoch = snapshot.session?.epoch;
  const roomId = snapshot.room.id;
  const state = useRef({
    active: false,
    generation: 0,
    reportId: '',
    sequence: 0,
    sample: null as { metrics: ReceiverMetrics; at: number; version: number } | null,
    sent: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    request: null as AbortController | null,
  });
  const actions = useMemo(() => {
    const current = state.current;
    function stop() {
      current.active = false;
      current.generation++;
      current.sample = null;
      clearTimeout(current.timer);
      current.request?.abort();
    }
    function reset() {
      stop();
      current.active = true;
      current.reportId = crypto.randomUUID();
      current.sequence = 0;
      current.sent = 0;
      const generation = current.generation;
      async function tick() {
        if (!current.active || generation !== current.generation) return;
        const sample = current.sample;
        if (
          sessionId &&
          epoch &&
          sample &&
          sample.version !== current.sent &&
          performance.now() - sample.at <= 2500
        ) {
          const request = new AbortController();
          current.request = request;
          const deadline = setTimeout(() => request.abort(), 2000);
          current.sent = sample.version;
          try {
            await api.report(
              roomId,
              {
                sessionId,
                epoch,
                reportId: current.reportId,
                sequence: ++current.sequence,
                metrics: sample.metrics,
              },
              request.signal,
            );
          } catch {
            // Reports are advisory. A failed diagnostic request never changes
            // media authorization, starts capture, or adjusts publication.
          } finally {
            clearTimeout(deadline);
          }
        }
        if (current.active && generation === current.generation)
          current.timer = setTimeout(() => {
            void tick();
          }, 3000);
      }
      current.timer = setTimeout(() => {
        void tick();
      }, 3000);
    }
    function sample(metrics: ReceiverMetrics) {
      if (!current.active) return;
      const parsed = receiverMetricsSchema.safeParse(metrics);
      if (!parsed.success) {
        reset();
        return;
      }
      const now = performance.now();
      // SDK baseline/counter resets emit an unavailable interval; renewals
      // explicitly reset. Ordinary scheduling gaps never invent new deltas.
      current.sample = {
        metrics: parsed.data,
        at: now,
        version: (current.sample?.version ?? 0) + 1,
      };
    }
    return { stop, reset, sample };
  }, [api, sessionId, epoch, roomId]);
  useEffect(() => actions.stop, [actions]);
  return actions;
}
