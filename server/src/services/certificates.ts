import fs from 'node:fs';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates } from '../db/schema.js';
import { config } from '../config.js';

export type Certificate = InferSelectModel<typeof certificates>;

export type DisplayStatus = 'issuing' | 'ok' | 'expiring' | 'expired' | 'error';

export interface CertificateView extends Omit<Certificate, 'domains'> {
  domains: string[];
  daysLeft: number | null;
  displayStatus: DisplayStatus;
}

export interface CertInfo {
  subject: string;
  issuer: string;
  validFrom: string | null;
  validTo: string | null;
  sans: string[];
  fingerprint256: string;
}

const DOMAIN_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

export function parseDomains(cert: Certificate): string[] {
  try {
    const parsed = JSON.parse(cert.domains);
    return Array.isArray(parsed) ? parsed.filter((d) => typeof d === 'string') : [];
  } catch {
    return [cert.primaryDomain];
  }
}

export function isEccKey(keyType: string): boolean {
  return keyType.startsWith('ec');
}

/** 主域名 → 目录名：通配符 *.example.com 记为 example.com-wildcard，其余仅保留文件系统安全字符 */
export function dirNameFor(primaryDomain: string): string {
  const lower = primaryDomain.trim().toLowerCase();
  const base = lower.startsWith('*.') ? `${lower.slice(2)}-wildcard` : lower;
  return base.replace(/[^a-z0-9.-]/g, '-');
}

/**
 * 证书文件的存放目录：storage/certificates/<主域名>/。
 * 同一主域名新建了多个证书时，后来的追加 -<id> 后缀避免覆盖；
 * 旧版本按数字 id 存放的目录，会在下次签发/续期安装成功后被清理。
 */
export function filesFor(cert: Pick<Certificate, 'id' | 'primaryDomain'>): {
  dir: string;
  fullchain: string;
  key: string;
  cert: string;
  chain: string;
} {
  let name = dirNameFor(cert.primaryDomain);
  const clash = db
    .select({ id: certificates.id })
    .from(certificates)
    .where(and(eq(certificates.primaryDomain, cert.primaryDomain), lt(certificates.id, cert.id)))
    .all();
  if (clash.length > 0) name = `${name}-${cert.id}`;
  const dir = path.join(config.certDir, name);
  return {
    dir,
    fullchain: path.join(dir, 'fullchain.pem'),
    key: path.join(dir, 'privkey.pem'),
    cert: path.join(dir, 'cert.pem'),
    chain: path.join(dir, 'chain.pem'),
  };
}

function toDate(value: unknown): string | null {
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseCertPem(pem: string): CertInfo {
  const firstBlock = `${pem.split('-----END CERTIFICATE-----')[0]}-----END CERTIFICATE-----\n`;
  const x509 = new X509Certificate(firstBlock);
  let sans: string[] = [];
  try {
    sans = (x509.subjectAltName ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.toUpperCase().startsWith('DNS:'))
      .map((s) => s.slice('DNS:'.length));
  } catch {
    sans = [];
  }
  return {
    subject: x509.subject,
    issuer: x509.issuer,
    validFrom: toDate(x509.validFrom),
    validTo: toDate(x509.validTo),
    sans,
    fingerprint256: x509.fingerprint256,
  };
}

/** 读取本地证书文件并解析（文件不存在返回 null） */
export function readCertInfo(cert: Certificate): CertInfo | null {
  const file = cert.certPath ?? filesFor(cert).fullchain;
  if (!cert.certPath || !fs.existsSync(file)) return null;
  try {
    return parseCertPem(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function daysLeftOf(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

export function displayStatusOf(cert: Certificate): DisplayStatus {
  if (cert.status === 'issuing') return 'issuing';
  if (cert.status === 'error') return 'error';
  const left = daysLeftOf(cert.expiresAt);
  if (left === null) return 'ok';
  if (left < 0) return 'expired';
  if (left <= cert.renewBeforeDays) return 'expiring';
  return 'ok';
}

export function toView(cert: Certificate): CertificateView {
  return {
    ...cert,
    domains: parseDomains(cert),
    daysLeft: daysLeftOf(cert.expiresAt),
    displayStatus: displayStatusOf(cert),
  };
}
