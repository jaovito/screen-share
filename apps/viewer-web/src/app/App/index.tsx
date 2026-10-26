import { LocaleProvider } from '@screen-share/i18n';
import { ViewerPage, viewerTranslations } from '../../features/stream-viewer';

export function App() {
  return (
    <LocaleProvider translations={viewerTranslations} titleKey="documentTitle">
      <ViewerPage />
    </LocaleProvider>
  );
}
