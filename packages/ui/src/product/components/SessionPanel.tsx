import type { RoomSnapshot } from '@screen-share/contracts';
import { useCallback, useEffect, useState } from 'react';
import type { ProductSessionController } from '../hooks/use-product-session';
import { useProductMessages } from '../locales';
import { generateMediaKey } from '../services/media-key';
import type { ProductApi } from '../services/product-api';
import type { ProductWorkspaceProps } from '../types';
import { PublisherPanel } from './PublisherPanel';
import { ReceiverPanel } from './ReceiverPanel';
import { SecretValue } from './SecretValue';

export function SessionPanel({
  api,
  snapshot,
  controller,
  publisher,
  receiver,
}: {
  api: ProductApi;
  snapshot: RoomSnapshot;
  controller: ProductSessionController;
  publisher: ProductWorkspaceProps['publisher'];
  receiver: ProductWorkspaceProps['receiver'];
}) {
  const t = useProductMessages();
  const [privateKey, setPrivateKey] = useState<{ sessionId: string; value: string } | null>(null);
  const [distributed, setDistributed] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const owner = snapshot.room.membership === 'owner';
  const session = snapshot.session;
  const key = privateKey?.sessionId === session?.id ? (privateKey?.value ?? '') : '';
  const preparing = session?.state === 'preparing';
  const active = session?.state === 'active';

  const generate = useCallback((sessionId: string) => {
    try {
      setPrivateKey({ sessionId, value: generateMediaKey() });
      setDistributed(false);
      setKeyError(false);
    } catch {
      setPrivateKey(null);
      setKeyError(true);
    }
  }, []);

  const sessionId = session?.id;

  useEffect(() => {
    if (owner && preparing && sessionId) generate(sessionId);
  }, [owner, preparing, sessionId, generate]);

  return (
    <>
      <section className="panel session-panel">
        <div className="panel-heading">
          <h2>{t('session')}</h2>
          <span className="badge">{t(`state_${snapshot.room.state}`)}</span>
        </div>
        {session ? <p>{t('epoch', { epoch: session.epoch })}</p> : <p>{t('noSession')}</p>}
        {snapshot.cleanupPending && <p role="status">{t('accessChanging')}</p>}
        {owner && (
          <div className="product-actions">
            <button
              type="button"
              disabled={controller.busy || snapshot.cleanupPending || preparing || active}
              onClick={() => {
                void controller.perform((signal) => api.prepare(snapshot.room.id, signal));
              }}
            >
              {t('prepare')}
            </button>
            {session && ['preparing', 'active'].includes(session.state) && (
              <button
                type="button"
                className="secondary danger"
                disabled={controller.busy}
                onClick={() => {
                  void controller.perform(
                    (signal) => api.transition(snapshot, 'close', signal),
                    () => {
                      setPrivateKey(null);
                      setDistributed(false);
                    },
                  );
                }}
              >
                {t('stopSession')}
              </button>
            )}
          </div>
        )}
        {owner && preparing && (
          <div className="private-callout">
            {!key && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (session) generate(session.id);
                }}
              >
                {t('newKey')}
              </button>
            )}
            {key && <SecretValue value={key} label={t('keyLabel')} />}
            <p>{t('keyNotice')}</p>
            <label className="product-check">
              <input
                type="checkbox"
                checked={distributed}
                onChange={(event) => setDistributed(event.target.checked)}
                disabled={!key || controller.busy}
              />
              {t('activateNotice')}
            </label>
            <button
              type="button"
              disabled={!key || !distributed || controller.busy || snapshot.cleanupPending}
              onClick={() => {
                void controller.perform((signal) => api.transition(snapshot, 'activate', signal));
              }}
            >
              {t('activate')}
            </button>
          </div>
        )}
        {owner && active && key && (
          <div className="private-callout">
            <SecretValue value={key} label={t('keyLabel')} />
            <p className="notice">{t('keyNotice')}</p>
          </div>
        )}
        {owner && active && !key && <p role="status">{t('missingSessionKey')}</p>}
        {keyError && <p role="alert">{t('keyUnavailable')}</p>}
      </section>
      {owner && active && (
        <PublisherPanel api={api} snapshot={snapshot} mediaKey={key} publisher={publisher} />
      )}
      {!owner && active && receiver && controller.user && (
        <ReceiverPanel
          api={api}
          snapshot={snapshot}
          userId={controller.user.id}
          receiver={receiver}
        />
      )}
      {!owner && !active && (
        <section className="panel empty-player">
          <span aria-hidden="true">↗</span>
          <p>{t('waiting')}</p>
        </section>
      )}
    </>
  );
}
