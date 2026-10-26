// 界面文案的翻译统一走 vue-i18n（web/src/locales），本文件只保留格式化工具（日期格式跟随当前语言）。

import i18n from './locales';

function dateLocale(): string {
  return i18n.global.locale.value === 'en-US' ? 'en-US' : 'zh-CN';
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString(dateLocale(), { hour12: false });
}

export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString(dateLocale());
}

export function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(dateLocale(), { hour12: false });
}

export function keyTypeLabel(keyType: string): string {
  return keyType.toUpperCase();
}
