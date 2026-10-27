import { ProductPage, ViewerPage, viewerTranslations } from '@features/stream-viewer';
import { LocaleProvider } from '@screen-share/i18n';

export function App() {
  if (new URLSearchParams(window.location.search).get('mode') === 'experiment') {
    return (
      <LocaleProvider translations={viewerTranslations} titleKey="documentTitle">
        <ViewerPage />
      </LocaleProvider>
    );
  }

  return <ProductPage />;
}
