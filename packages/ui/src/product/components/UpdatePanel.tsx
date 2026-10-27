import { useEffect, useRef, useState } from 'react';
import { useProductMessages } from '../locales';
import type { UpdateInfo, UpdaterAdapter } from '../types';

export function UpdatePanel({ updater }: { updater: UpdaterAdapter }) {
  const t = useProductMessages();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function act(install: boolean) {
    if (pending.current || (install && (!confirmed || info?.state !== 'available'))) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (install) {
        await updater.install();
      } else {
        setInfo(null);
        setConfirmed(false);
        const next = await updater.check();
        if (mounted.current) setInfo(next);
      }
    } catch {
      if (mounted.current) {
        setFailed(true);
        setInfo(null);
        setConfirmed(false);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <details className="panel updates-panel">
      <summary>{t('updates')}</summary>
      <p className="notice">{t('updateNotice')}</p>
      <button
        className="secondary"
        type="button"
        disabled={busy}
        onClick={() => {
          void act(false);
        }}
      >
        {t('checkUpdates')}
      </button>
      {busy && <p role="status">{t('updateBusy')}</p>}
      {failed && <p role="alert">{t('updateFailed')}</p>}
      {info?.state === 'notConfigured' && <p role="status">{t('updateNotConfigured')}</p>}
      {info?.state === 'upToDate' && <p role="status">{t('updateCurrent')}</p>}
      {info?.state === 'available' && (
        <div>
          <p role="status">{t('updateAvailable', { version: info.version ?? '' })}</p>
          <label className="product-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t('updateConsent')}
          </label>
          <button
            type="button"
            disabled={!confirmed || busy}
            onClick={() => {
              void act(true);
            }}
          >
            {t('installUpdate')}
          </button>
        </div>
      )}
    </details>
  );
}
