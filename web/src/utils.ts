import type { DisplayStatus } from './types';

export function statusMeta(status: DisplayStatus): {
  label: string;
  type: 'success' | 'warning' | 'danger' | 'info';
} {
  switch (status) {
    case 'issuing':
      return { label: '签发中', type: 'info' };
    case 'ok':
      return { label: '正常', type: 'success' };
    case 'expiring':
      return { label: '即将过期', type: 'warning' };
    case 'expired':
      return { label: '已过期', type: 'danger' };
    case 'error':
      return { label: '异常', type: 'danger' };
  }
}

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

export function caLabel(ca: string): string {
  return ca === 'zerossl' ? 'ZeroSSL' : "Let's Encrypt";
}

export function challengeLabel(type: string): string {
  return type === 'dns01' ? 'DNS-01' : 'HTTP-01';
}

export function keyTypeLabel(keyType: string): string {
  return keyType.toUpperCase();
}

export function daysLeftText(daysLeft: number | null): string {
  if (daysLeft === null) return '-';
  if (daysLeft < 0) return `已过期 ${Math.abs(daysLeft)} 天`;
  return `${daysLeft} 天`;
}
