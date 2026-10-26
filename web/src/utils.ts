// 界面文案的翻译统一走 vue-i18n（web/src/locales），本文件只保留与语言无关的格式化工具。

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN', { hour12: false });
}

export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('zh-CN');
}

export function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function keyTypeLabel(keyType: string): string {
  return keyType.toUpperCase();
}
