import { ViewerPage, viewerTranslations } from '@features/stream-viewer';
import { LocaleProvider } from '@screen-share/i18n';

export function App() {
  return (
    <LocaleProvider translations={viewerTranslations} titleKey="documentTitle">
      <ViewerPage />
    </LocaleProvider>
  );
}
