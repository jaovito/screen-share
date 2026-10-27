import type { RoomSnapshot } from '@screen-share/contracts';
import type { ReceiverMetrics } from '@screen-share/diagnostics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReceiverReports } from '../hooks/use-receiver-reports';
import { type ProductMessage, useProductMessages } from '../locales';
import type { ProductApi } from '../services/product-api';
import type { ReceiverAdapter } from '../types';
import { ReceiverDiagnostics } from './ReceiverDiagnostics';

export function ReceiverPanel({
  api,
  snapshot,
  userId,
  receiver,
}: {
  api: ProductApi;
  snapshot: RoomSnapshot;
  userId: string;
  receiver: ReceiverAdapter;
}) {
  const t = useProductMessages();
  const [state, setState] = useState('idle');
  const [metrics, setMetrics] = useState<ReceiverMetrics | null>(null);
  const [consent, setConsent] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const key = useRef('');
  const generation = useRef(0);
  const connection = useRef<{ stop(): void } | null>(null);
  const request = useRef<AbortController | null>(null);
  const renewal = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const active = ['connecting', 'waiting', 'subscribed'].includes(state);
  const reports = useReceiverReports(api, snapshot);

  const stop = useCallback(() => {
    generation.current++;
    reports.stop();
    key.current = '';
    request.current?.abort();
    if (renewal.current) clearTimeout(renewal.current);
    connection.current?.stop();
    connection.current = null;
  }, [reports]);

  useEffect(() => {
    mounted.current = true;
    const offline = () => {
      stop();
      setState('failed');
    };
    window.addEventListener('offline', offline);
    return () => {
      mounted.current = false;
      stop();
      window.removeEventListener('offline', offline);
    };
  }, [stop]);

  async function rotate() {
    if (!key.current || !video.current || !snapshot.session) return;

    const attempt = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const grant = await api.grant(snapshot, 'viewer', controller.signal);
      if (!mounted.current || attempt !== generation.current || controller.signal.aborted) return;
      if (
        grant.sessionId !== snapshot.session.id ||
        grant.epoch !== snapshot.session.epoch ||
        grant.publisherId !== snapshot.session.publisherId ||
        grant.participantId !== userId ||
        grant.role !== 'viewer'
      ) {
        throw new Error('Unexpected media authorization binding');
      }

      connection.current?.stop();
      reports.reset();
      setMetrics(null);
      setState('connecting');
      const next = await receiver({
        grant,
        mediaKey: key.current,
        video: video.current,
        ...(audio.current ? { audio: audio.current } : {}),
        onMetrics: (sample) => {
          if (mounted.current && attempt === generation.current) {
            setMetrics(sample);
            reports.sample(sample);
          }
        },
        onState: (status) => {
          if (!mounted.current || attempt !== generation.current) return;
          setState(status);
          if (!['connecting', 'waiting', 'subscribed'].includes(status)) stop();
        },
      });
      if (!mounted.current || attempt !== generation.current) {
        next.stop();
        return;
      }

      connection.current = next;
      renewal.current = setTimeout(() => {
        void rotate();
      }, 20_000);
    } catch {
      if (mounted.current && attempt === generation.current) {
        stop();
        setState('failed');
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return (
    <section className="panel receive-panel">
      <h2>{t('player')}</h2>
      <video
        ref={video}
        aria-label={t('player')}
        autoPlay
        playsInline
        controls
        muted
        hidden={state !== 'subscribed'}
      />
      <audio
        ref={audio}
        aria-label={t('streamAudio')}
        muted
        autoPlay
        controls
        hidden={state !== 'subscribed'}
      />
      {!active && (
        <div className="empty-player" aria-hidden="true">
          ↗
        </div>
      )}
      <p role="status">{t(`status_${state}` as ProductMessage)}</p>
      <form
        className="product-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!consent || active) return;
          key.current = String(new FormData(event.currentTarget).get('mediaKey'));
          event.currentTarget.reset();
          setConsent(false);
          if (!/^[A-Za-z0-9_-]{43}$/.test(key.current)) {
            key.current = '';
            setState('invalidKey');
            return;
          }
          setState('connecting');
          void rotate();
        }}
      >
        <label>
          {t('keyLabel')}
          <input
            name="mediaKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            minLength={43}
            maxLength={43}
            disabled={active}
          />
        </label>
        <p className="notice">{t('keyRequired')}</p>
        <label className="product-check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            disabled={active}
          />
          {t('consent')}
        </label>
        <div className="product-actions">
          <button type="submit" disabled={!consent || active}>
            {t('connect')}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!active}
            onClick={() => {
              stop();
              setState('idle');
            }}
          >
            {t('disconnect')}
          </button>
        </div>
      </form>
      {state === 'subscribed' && <p className="notice">{t('audioPlaybackNotice')}</p>}
      {metrics && <ReceiverDiagnostics metrics={metrics} />}
      <p className="notice">{t('reconnectNotice')}</p>
    </section>
  );
}
