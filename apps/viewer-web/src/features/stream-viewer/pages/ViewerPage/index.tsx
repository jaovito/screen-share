import { LanguageSelector } from '@screen-share/i18n';
import { EncryptedSessionPanel } from '../../components/EncryptedSessionPanel';
import { useControlConnection } from '../../hooks/use-control-connection';
import { useViewerMessages } from '../../locales';

export function ViewerPage() {
  const { connection, retry } = useControlConnection();
  const t = useViewerMessages();
  const status = {
    loading: t('apiLoading'),
    ready: t('apiReady'),
    unavailable: t('apiUnavailable'),
    error: t('apiError'),
  }[connection.state];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header>
        <div className="brand">
          <span className="mark" aria-hidden="true">
            ↗
          </span>{' '}
          screen share
        </div>
        <div className="header-controls">
          <span className="badge">{t('badge')}</span>
          <LanguageSelector />
        </div>
      </header>
      <div className="eyebrow">{t('eyebrow')}</div>
      <h1>{t('heading')}</h1>
      <p>{t('intro')}</p>
      <div className="layout">
        <section className="panel player" aria-label={t('playerLabel')}>
          <span className="screen" aria-hidden="true">
            ▣
          </span>
          <h2>{t('playerHeading')}</h2>
          <p>{t('playerUnavailable')}</p>
          <span className="badge">{t('mediaPending')}</span>
        </section>
        <aside className="panel">
          <h2>{t('connectionHeading')}</h2>
          <p
            role="status"
            aria-live="polite"
            className={`status ${connection.state === 'ready' ? 'ready' : 'error'}`}
          >
            {status}
          </p>
          <button type="button" className="secondary" onClick={retry}>
            {t('retry')}
          </button>
          <p className="notice">{t('controlNotice')}</p>
        </aside>
      </div>
      <section className="panel mt-6">
        <h2>{t('catalogHeading')}</h2>
        <p>{t('catalogNotice')}</p>
        {connection.state === 'ready' ? (
          <div className="profile-grid">
            {connection.profiles.map((profile) => (
              <div className="profile" key={profile.id}>
                <strong>{t('profileLabel', { height: profile.height, fps: profile.fps })}</strong>
                <span>
                  {profile.width} × {profile.height}
                  {profile.height === 1440 ? ' · QHD' : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p>{connection.state === 'loading' ? t('catalogLoading') : t('catalogUnavailable')}</p>
        )}
      </section>
      <EncryptedSessionPanel />
      <footer>{t('footer')}</footer>
    </main>
  );
}
