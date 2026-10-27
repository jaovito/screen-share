import { ControlPage, controlTranslations } from '@features/stream-control';
import { LocaleProvider } from '@screen-share/i18n';

export function App() {
  return (
    <LocaleProvider translations={controlTranslations} titleKey="documentTitle">
      <ControlPage />
    </LocaleProvider>
  );
}
