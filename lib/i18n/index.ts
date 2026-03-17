import { defaultLocale } from './types';
export { type Locale, defaultLocale } from './types';
import { commonEnUS } from './common';
import { stageEnUS } from './stage';
import { chatEnUS } from './chat';
import { generationEnUS } from './generation';
import { settingsEnUS } from './settings';
import { browseEnUS } from './browse';

const enUS = {
  ...commonEnUS,
  ...stageEnUS,
  ...chatEnUS,
  ...generationEnUS,
  ...settingsEnUS,
  ...browseEnUS,
};

export const translations = {
  'zh-CN': enUS,
  'en-US': enUS,
} as const;

export type TranslationKey = keyof (typeof translations)[typeof defaultLocale];
