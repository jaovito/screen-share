import type { RoomSnapshot } from '@screen-share/contracts';
import { useEffect, useRef, useState } from 'react';
import { type ProductMessage, useProductMessages } from '../locales';
import type { ProductApi } from '../services/product-api';
import type { NativeSharingStatus, PublisherAdapter } from '../types';
import { AudioControls, type AudioSelection } from './AudioControls';
import { PeerReportsPanel } from './PeerReportsPanel';
import { PublisherDiagnostics } from './PublisherDiagnostics';

export function PublisherPanel({
  api,
  snapshot,
  mediaKey,
  publisher,
}: {
  api: ProductApi;
  snapshot: RoomSnapshot;
  mediaKey: string;
  publisher: PublisherAdapter | undefined;
}) {
  const t = useProductMessages();
  const [profileId, setProfileId] = useState('1080p60');
  const [bitrate, setBitrate] = useState(10);
  const [status, setStatus] = useState<NativeSharingStatus | null>(null);
  const [audio, setAudio] = useState<AudioSelection>({ mode: 'off' });
  const [qualityMode, setQualityMode] = useState<'motion' | 'text'>('motion');
  const [mediaError, setMediaError] = useState(false);
  const audioRef = useRef(false);
  audioRef.current = audio.mode !== 'off';
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const active = status && ['selecting', 'connecting', 'sharing', 'paused'].includes(status.state);
  const audioReady =
    audio.mode !== 'process' || (audio.processId !== undefined && audio.creationTime !== undefined);
  const nativeReady =
    publisher && status && !['unsupported_platform', 'engine_missing'].includes(status.state);

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout>;
    let renewTimer: ReturnType<typeof setTimeout> | undefined;

    async function renew() {
      const controller = new AbortController();
      request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const currentSnapshot = snapshotRef.current;
        if (!publisher || stopped || !currentSnapshot.session) return;
        const current = await publisher.status();
        if (!['sharing', 'paused', 'connecting'].includes(current.state)) return;
        const grant = await api.grant(
          currentSnapshot,
          'publisher',
          controller.signal,
          audioRef.current,
        );
        if (stopped || controller.signal.aborted) return;
        if (
          grant.sessionId !== currentSnapshot.session.id ||
          grant.epoch !== currentSnapshot.session.epoch ||
          grant.participantId !== currentSnapshot.room.ownerId
        )
          throw new Error('Unexpected publisher grant');
        const result = await publisher.renew(grant);
        if (!stopped) setStatus(result);
      } catch {
        if (!stopped) {
          setMediaError(true);
          await publisher?.stop().catch(() => {});
          setStatus((previous) => (previous ? { ...previous, state: 'failed' } : null));
        }
      } finally {
        clearTimeout(timeout);
        if (!stopped)
          renewTimer = setTimeout(() => {
            void renew();
          }, 20_000);
      }
    }

    async function poll() {
      const version = generation.current;
      try {
        const next = await publisher?.status();
        if (!stopped && version === generation.current && next) setStatus(next);
      } catch {
        if (!stopped) {
          setMediaError(true);
          await publisher?.stop().catch(() => {});
          setStatus((previous) => (previous ? { ...previous, state: 'failed' } : null));
        }
      }
      if (!stopped)
        pollTimer = setTimeout(() => {
          void poll();
        }, 1000);
    }

    void poll();
    if (!publisher?.managesAuthorization)
      renewTimer = setTimeout(() => {
        void renew();
      }, 20_000);
    return () => {
      stopped = true;
      mounted.current = false;
      generation.current++;
      request.current?.abort();
      clearTimeout(pollTimer);
      clearTimeout(renewTimer);
      void publisher?.stop().catch(() => {});
    };
  }, [publisher, api]);

  async function act(action: () => Promise<NativeSharingStatus>) {
    if (busy) return;
    const attempt = ++generation.current;
    setBusy(true);
    try {
      const next = await action();
      if (mounted.current && generation.current === attempt) {
        setMediaError(false);
        setStatus(next);
      }
    } catch {
      setMediaError(true);
      await publisher?.stop().catch(() => {});
      if (mounted.current && generation.current === attempt) {
        setStatus({
          state: 'failed',
          profileId: null,
          elapsedMs: 0,
          framesCaptured: 0,
          framesEncoded: 0,
          encodedBytes: 0,
          queueReplacements: 0,
          captureFps: null,
          encodedFps: null,
          targetFps: null,
          audioSupported: false,
          reason: null,
          encryption: 'pending',
        });
      }
    } finally {
      if (mounted.current && generation.current === attempt) setBusy(false);
    }
  }

  return (
    <section className="panel publisher-panel">
      <h2>{t('selectSource')}</h2>
      {!publisher && <p className="notice">{t('nativeUnavailable')}</p>}
      <form
        className="product-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!publisher || !nativeReady || !audioReady || !mediaKey || !snapshot.session) return;
          void act(async () => {
            const controller = new AbortController();
            request.current = controller;
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
              const grant = await api.grant(
                snapshot,
                'publisher',
                controller.signal,
                audio.mode !== 'off',
              );
              if (
                !mounted.current ||
                controller.signal.aborted ||
                grant.sessionId !== snapshot.session?.id ||
                grant.participantId !== snapshot.room.ownerId ||
                grant.publisherId !== snapshot.room.ownerId ||
                grant.role !== 'publisher' ||
                grant.epoch !== snapshot.session?.epoch
              )
                throw new Error('Unexpected publisher grant');
              if (active)
                return await publisher.renew(grant, profileId, Math.round(bitrate * 1_000_000));
              return await publisher.start({
                roomId: snapshot.room.id,
                grant,
                profileId,
                bitrateBps: Math.round(bitrate * 1_000_000),
                mediaKey,
                audioMode: audio.mode,
                ...(audio.mode === 'process' &&
                audio.processId !== undefined &&
                audio.creationTime !== undefined
                  ? { audioProcessId: audio.processId, audioProcessCreatedAt: audio.creationTime }
                  : {}),
                qualityMode,
              });
            } finally {
              clearTimeout(timeout);
            }
          });
        }}
      >
        <div className="profile-controls">
          <label>
            {t('profile')}
            <select
              value={profileId}
              disabled={busy}
              onChange={(event) => setProfileId(event.target.value)}
            >
              {(
                [
                  [854, 480],
                  [1280, 720],
                  [1920, 1080],
                  [2560, 1440],
                ] as const
              ).flatMap(([width, height]) =>
                [30, 60].map((fps) => (
                  <option key={`${height}p${fps}`} value={`${height}p${fps}`}>
                    {width} × {height}
                    {height === 1440 ? ' · QHD' : ''} · {fps} FPS
                  </option>
                )),
              )}
            </select>
          </label>
          <label>
            {t('bitrate')}
            <input
              type="number"
              min={0.064}
              max={50}
              step={0.001}
              value={bitrate}
              disabled={busy}
              onChange={(event) => setBitrate(Number(event.target.value))}
              required
            />
          </label>
        </div>
        <label>
          {t('qualityMode')}
          <select
            value={qualityMode}
            disabled={!!active || busy}
            onChange={(event) => setQualityMode(event.target.value === 'text' ? 'text' : 'motion')}
          >
            <option value="motion">{t('qualityMotion')}</option>
            <option value="text">{t('qualityText')}</option>
          </select>
        </label>
        <p className="notice">{t('qualityNotice')}</p>
        <AudioControls
          publisher={publisher}
          supported={status?.audioSupported ?? false}
          locked={!!active || busy}
          value={audio}
          onChange={setAudio}
        />
        <button type="submit" disabled={!nativeReady || !audioReady || !mediaKey || busy}>
          {t(active ? 'applyProfile' : 'selectSource')}
        </button>
      </form>
      <div className="product-actions">
        <button
          type="button"
          className="secondary"
          disabled={!publisher || !status || !['sharing', 'paused'].includes(status.state) || busy}
          onClick={() => {
            if (publisher)
              void act(() => (status?.state === 'paused' ? publisher.resume() : publisher.pause()));
          }}
        >
          {t(status?.state === 'paused' ? 'resume' : 'pause')}
        </button>
        <button
          type="button"
          className="secondary danger"
          disabled={!publisher || !active || busy}
          onClick={() => {
            if (publisher) void act(() => publisher.stop());
          }}
        >
          {t('stop')}
        </button>
      </div>
      <p role="status">
        {t(`status_${mediaError ? 'failed' : (status?.state ?? 'idle')}` as ProductMessage)}
      </p>
      <p className="notice">{t('sourceNotice')}</p>
      <PeerReportsPanel api={api} snapshot={snapshot} publisherStatus={status} />
      {status?.adaptationReason && (
        <p className="notice">
          {t(
            status.adaptationReason === 'network_pressure' ? 'qualityReduced' : 'qualityRestored',
            {
              profile: status.profileId ?? '—',
              bitrate: status.targetBitrateBps ?? '—',
              changes: status.qualityChanges ?? 0,
            },
          )}
        </p>
      )}
      {status && <PublisherDiagnostics status={status} />}
    </section>
  );
}
