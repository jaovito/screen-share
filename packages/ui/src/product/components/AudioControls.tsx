import type { AudioSource } from '@screen-share/contracts';
import { useEffect, useRef, useState } from 'react';
import { useProductMessages } from '../locales';
import type { PublisherAdapter } from '../types';

export type AudioSelection = {
  mode: 'off' | 'system' | 'process';
  processId?: number;
  creationTime?: string;
};

export function AudioControls({
  publisher,
  supported,
  locked,
  value,
  onChange,
}: {
  publisher: PublisherAdapter | undefined;
  supported: boolean;
  locked: boolean;
  value: AudioSelection;
  onChange(value: AudioSelection): void;
}) {
  const t = useProductMessages();
  const [sources, setSources] = useState<AudioSource[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);

  async function chooseApplications() {
    if (locked || !supported || !publisher?.audioSources) return;
    const attempt = ++generation.current;
    onChange({ mode: 'process' });
    setSources([]);
    setState('loading');
    try {
      const response = await publisher.audioSources();
      if (!mounted.current || attempt !== generation.current) return;
      setSources(response.sources);
      setState(response.state === 'ready' ? 'ready' : 'unavailable');
    } catch {
      if (mounted.current && attempt === generation.current) setState('unavailable');
    }
  }

  return (
    <div className="audio-controls">
      <label>
        {t('audioMode')}
        <select
          value={value.mode}
          disabled={!publisher || !supported || locked}
          onChange={(event) => {
            const mode = event.target.value;
            if (mode === 'process') {
              void chooseApplications();
              return;
            }
            if (mode !== 'off' && mode !== 'system') return;
            generation.current++;
            setSources([]);
            setState('idle');
            onChange({ mode });
          }}
        >
          <option value="off">{t('audioOff')}</option>
          <option value="process" disabled={!publisher?.audioSources}>
            {t('applicationAudio')}
          </option>
          <option value="system">{t('systemAudio')}</option>
        </select>
      </label>
      {value.mode === 'system' && <p className="notice">{t('systemAudioNotice')}</p>}
      {value.mode === 'process' && (
        <>
          <p className="notice">{t('applicationAudioNotice')}</p>
          <label>
            {t('audioApplication')}
            <select
              value={value.processId?.toString() ?? ''}
              required
              disabled={locked || state !== 'ready'}
              onChange={(event) => {
                const chosen = sources.find(
                  (source) => source.processId.toString() === event.target.value,
                );
                onChange(
                  chosen
                    ? {
                        mode: 'process',
                        processId: chosen.processId,
                        creationTime: chosen.creationTime,
                      }
                    : { mode: 'process' },
                );
              }}
            >
              <option value="">{t('chooseAudioApplication')}</option>
              {sources.map((source) => (
                <option key={`${source.processId}:${source.creationTime}`} value={source.processId}>
                  {source.label} · PID {source.processId}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            disabled={locked || state === 'loading'}
            onClick={() => {
              void chooseApplications();
            }}
          >
            {t('chooseAudioApplication')}
          </button>
          {state === 'loading' && <p role="status">{t('loadingAudioApplications')}</p>}
          {state === 'unavailable' && <p role="status">{t('audioApplicationsUnavailable')}</p>}
          {state === 'ready' && sources.length === 0 && (
            <p role="status">{t('noAudioApplications')}</p>
          )}
        </>
      )}
    </div>
  );
}
