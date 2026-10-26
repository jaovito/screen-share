import { LanguageSelector } from '@screen-share/i18n';
import { useAppInfo } from '../../hooks/use-app-info';
import { useControlMessages } from '../../locales';

export function ControlPage() {
  const { info, error } = useAppInfo();
  const t = useControlMessages();

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
        <section className="panel player">
          <span className="screen" aria-hidden="true">
            ▣
          </span>
          <h2>{t('sourceHeading')}</h2>
          <p>{t('mediaUnavailable')}</p>
          <button type="button" disabled>
            {t('start')}
          </button>
        </section>
        <aside className="panel">
          <h2>{t('appHeading')}</h2>
          {error ? (
            <p role="status">{t('shellError')}</p>
          ) : info ? (
            <dl className="details">
              <dt>{t('version')}</dt>
              <dd>{info.version}</dd>
              <dt>{t('platform')}</dt>
              <dd>{info.platform}</dd>
              <dt>{t('mediaEngine')}</dt>
              <dd>
                {info.mediaStatus === 'unsupported_platform'
                  ? t('unsupported')
                  : t('notImplemented')}
              </dd>
            </dl>
          ) : (
            <p role="status">{t('shellLoading')}</p>
          )}
          <p className="notice">{t('notice')}</p>
        </aside>
      </div>
      <footer>{t('footer')}</footer>
    </main>
  );
}
