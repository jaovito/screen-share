import { type Translations, useMessages } from '@screen-share/i18n';
import en from './en';
import es from './es';
import ptBR from './pt-BR';

export const viewerTranslations = { 'pt-BR': ptBR, es, en } satisfies Translations<typeof en>;

export function useViewerMessages() {
  return useMessages<typeof en>();
}
