import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useViewerMessages } from '../../locales';
import type { ReceptionState } from '../../services/encrypted-reception';

function ReceptionForm() {
  const t = useViewerMessages();
  const [grantText, setGrantText] = useState('');
  const [mediaKey, setMediaKey] = useState('');
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<ReceptionState>('idle');
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const reception = useRef<{ stop(): void } | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const active = ['connecting', 'waiting', 'subscribed'].includes(state);

  useEffect(
    () => () => {
      generation.current++;
      pending.current = false;
      reception.current?.stop();
      reception.current = null;
    },
    [],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent || !video.current || pending.current) return;

    const attempt = ++generation.current;
    pending.current = true;
    const mediaElement = video.current;
    let keyMaterial = mediaKey;
    let grant: unknown;
    try {
      grant = JSON.parse(grantText);
    } catch {
      grant = null;
    }

    setGrantText('');
    setMediaKey('');
    setConsent(false);
    setState('connecting');
    reception.current?.stop();
    reception.current = null;

    try {
      const { receiveEncryptedSession } = await import('../../services/encrypted-reception');
      if (generation.current !== attempt) return;
      reception.current = receiveEncryptedSession({
        grant,
        mediaKey: keyMaterial,
        video: mediaElement,
        ...(audio.current ? { audio: audio.current } : {}),
        onState: (next) => {
          if (generation.current !== attempt) return;
          pending.current = ['connecting', 'waiting', 'subscribed'].includes(next);
          setState(next);
        },
      });
    } catch {
      if (generation.current === attempt) {
        pending.current = false;
        setState('failed');
      }
    } finally {
      keyMaterial = '';
      grant = null;
    }
  }

  function disconnect() {
    generation.current++;
    pending.current = false;
    reception.current?.stop();
    reception.current = null;
    setState('idle');
  }

  return (
    <div className="proof-content">
      <p className="notice">{t('proofNotice')}</p>
      <form className="proof-form" onSubmit={submit}>
        <label htmlFor="proof-grant">{t('proofGrant')}</label>
        <textarea
          id="proof-grant"
          value={grantText}
          onChange={(event) => setGrantText(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={12_000}
          disabled={active}
          required
        />
        <label htmlFor="proof-key">{t('proofKey')}</label>
        <input
          id="proof-key"
          type="password"
          value={mediaKey}
          onChange={(event) => setMediaKey(event.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={43}
          disabled={active}
          required
        />
        <label className="proof-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            disabled={active}
          />
          <span>{t('proofConsent')}</span>
        </label>
        <div className="proof-actions">
          <button type="submit" disabled={!consent || active}>
            {t('proofConnect')}
          </button>
          <button type="button" className="secondary" onClick={disconnect} disabled={!active}>
            {t('proofDisconnect')}
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite" className="status">
        {t(`proofState_${state}`)}
      </p>
      <audio ref={audio} autoPlay controls muted aria-label={t('proofAudio')} />
      <video
        ref={video}
        aria-label={t('proofVideo')}
        autoPlay
        playsInline
        muted
        controls
        hidden={state !== 'subscribed'}
      />
    </div>
  );
}

export function EncryptedSessionPanel() {
  const t = useViewerMessages();
  const [expanded, setExpanded] = useState(false);

  return (
    <details
      className="panel proof-panel mt-6"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{t('proofHeading')}</summary>
      {expanded ? <ReceptionForm /> : null}
    </details>
  );
}
