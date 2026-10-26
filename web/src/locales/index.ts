import { createI18n } from 'vue-i18n';
import zhCN from './zh-CN';
import enUS from './en-US';

export type Locale = 'zh-CN' | 'en-US';

const STORAGE_KEY = 'acme-locale';

export function initialLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'en-US' || saved === 'zh-CN' ? saved : 'zh-CN';
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  i18n.global.locale.value = locale;
}

const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
});

export default i18n;
