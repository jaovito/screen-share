import { type Translations, useMessages } from '@screen-share/i18n';
import { en } from './en';
import { es } from './es';
import { ptBR } from './pt-BR';

export const productTranslations = { 'pt-BR': ptBR, es, en } satisfies Translations<typeof en>;
export type ProductMessage = keyof typeof en;

export function useProductMessages() {
  return useMessages<typeof en>();
}
