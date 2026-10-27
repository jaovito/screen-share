import { ControlPage, controlTranslations, ProductPage } from '@features/stream-control';
import { LocaleProvider } from '@screen-share/i18n';

export function App() {
  if (new URLSearchParams(window.location.search).get('mode') === 'experiment') {
    return (
      <LocaleProvider translations={controlTranslations} titleKey="documentTitle">
        <ControlPage />
      </LocaleProvider>
    );
  }

  return <ProductPage />;
}
