import { LocaleProvider } from '@screen-share/i18n';
import { ControlPage, controlTranslations } from '../../features/stream-control';

export function App() {
  return (
    <LocaleProvider translations={controlTranslations} titleKey="documentTitle">
      <ControlPage />
    </LocaleProvider>
  );
}
