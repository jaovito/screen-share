import { LanguageSelector, LocaleProvider } from '@screen-share/i18n';
import { useMemo } from 'react';
import { AuthPanel } from './components/AuthPanel';
import { PeoplePanel } from './components/PeoplePanel';
import { RoomNavigation } from './components/RoomNavigation';
import { SessionPanel } from './components/SessionPanel';
import { UpdatePanel } from './components/UpdatePanel';
import { useProductSession } from './hooks/use-product-session';
import { productTranslations, useProductMessages } from './locales';
import { createProductApi } from './services/product-api';
import type { ProductWorkspaceProps } from './types';

function Workspace({ apiUrl, control, publisher, receiver, updater }: ProductWorkspaceProps) {
  const api = useMemo(() => createProductApi(apiUrl, control), [apiUrl, control]);
  const controller = useProductSession(api);
  const t = useProductMessages();
  const snapshot = controller.snapshot;
  const binding = snapshot
    ? `${snapshot.room.id}:${snapshot.room.epoch}:${snapshot.room.membershipRevision}`
    : 'none';

  return (
    <main className="product-workspace">
      <header>
        <div className="brand">
          <span className="mark" aria-hidden="true">
            ↗
          </span>
          screen share
        </div>
        <div className="header-controls">
          <span className="badge">{t('badge')}</span>
          <LanguageSelector />
          {controller.user && (
            <button
              className="secondary"
              type="button"
              disabled={controller.busy}
              onClick={() => {
                controller.select(null);
                void publisher?.stop().catch(() => {});
                void controller.perform((signal) => api.signOut(signal));
              }}
            >
              {t('signOut')}
            </button>
          )}
        </div>
      </header>
      <div className="workspace-intro">
        <div className="eyebrow">screen share</div>
        <h1>{t('heading')}</h1>
        <p>{t('introduction')}</p>
      </div>
      {updater && <UpdatePanel updater={updater} />}
      {controller.phase === 'loading' && <p role="status">{t('loading')}</p>}
      {controller.phase === 'offline' && (
        <div className="panel error-banner" role="alert">
          <p>{t('offline')}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void controller.refresh();
            }}
          >
            {t('retry')}
          </button>
        </div>
      )}
      {controller.error && (
        <p className="error-banner" role="alert">
          {t('error')}
        </p>
      )}
      {controller.phase === 'ready' && !controller.user && (
        <AuthPanel api={api} controller={controller} />
      )}
      {controller.phase === 'ready' && controller.user && (
        <div className="workspace-grid">
          <RoomNavigation api={api} controller={controller} />
          <div className="room-content" key={binding}>
            {snapshot && (
              <>
                <h2 className="room-title">{snapshot.room.name}</h2>
                {snapshot.room.membership === 'pending' ? (
                  <section className="panel">
                    <p role="status">{t('pending')}</p>
                  </section>
                ) : (
                  <>
                    <SessionPanel
                      api={api}
                      snapshot={snapshot}
                      controller={controller}
                      publisher={publisher}
                      receiver={receiver}
                    />
                    <PeoplePanel api={api} controller={controller} snapshot={snapshot} />
                  </>
                )}
              </>
            )}
            {!snapshot && (
              <section className="panel empty-player">
                <span aria-hidden="true">↗</span>
                <p>{t(controller.selected ? 'loading' : 'noRooms')}</p>
              </section>
            )}
          </div>
        </div>
      )}
      <footer>{t('privacy')}</footer>
    </main>
  );
}

export function ProductWorkspace(props: ProductWorkspaceProps) {
  return (
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <Workspace {...props} />
    </LocaleProvider>
  );
}
