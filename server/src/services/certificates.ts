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

/** 单个部署目标（certificates.deployTargets JSON 数组中的一项） */
export interface DeployTarget {
  id: string;
  name: string;
  enabled: boolean;
  /** none（仅复制） | command（容器内命令） | docker（Docker 容器） */
  mode: 'none' | 'command' | 'docker';
  /** 容器内绝对路径 */
  targetDir: string;
  cmd: string;
  container: string;
  lastRunAt: string | null;
  lastError: string | null;
}

function isDeployTarget(v: unknown): v is DeployTarget {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.targetDir === 'string' &&
    typeof t.cmd === 'string' &&
    typeof t.container === 'string' &&
    typeof t.enabled === 'boolean' &&
    (t.mode === 'none' || t.mode === 'command' || t.mode === 'docker') &&
    (t.lastRunAt === null || typeof t.lastRunAt === 'string') &&
    (t.lastError === null || typeof t.lastError === 'string')
  );
}

/**
 * 读取部署目标列表。deployTargets 列有值时直接解析；
 * 旧版单目标列（deployEnabled/deployTargetDir/...）自动折算成一项，保存新配置后即完成迁移。
 */
export function targetsOf(cert: Certificate): DeployTarget[] {
  const raw = cert.deployTargets?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(isDeployTarget);
    } catch {
      // JSON 损坏时回落到旧列
    }
  }
  const dir = (cert.deployTargetDir ?? '').trim();
  if (!dir) return [];
  return [
    {
      id: 'legacy',
      name: '默认目标',
      enabled: cert.deployEnabled,
      mode: (cert.deployMode ?? 'none') as DeployTarget['mode'],
      targetDir: dir,
      cmd: cert.deployCmd ?? '',
      container: cert.deployContainer ?? '',
      lastRunAt: cert.lastDeployAt ?? null,
      lastError: cert.lastDeployError ?? null,
    },
  ];
}

export function hasEnabledTargets(cert: Certificate): boolean {
  return targetsOf(cert).some((t) => t.enabled);
}

export interface CertificateView extends Omit<Certificate, 'domains' | 'deployTargets'> {
  domains: string[];
  daysLeft: number | null;
  displayStatus: DisplayStatus;
  /** 宿主机视角的文件路径（未运行在容器或未识别到挂载时与 certPath 相同） */
  hostCertPath: string | null;
  hostKeyPath: string | null;
  deployTargets: DeployTarget[];
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

/** 容器内路径 → 宿主机路径；不在 storage 目录下或未识别到挂载时原样返回 */
export function toHostPath(p: string | null): string | null {
  if (!p || !config.hostStorageDir) return p;
  if (p === config.storageDir || p.startsWith(`${config.storageDir}/`)) {
    return path.join(config.hostStorageDir, p.slice(config.storageDir.length));
  }
  return p;
}

export function toView(cert: Certificate): CertificateView {
  return {
    ...cert,
    domains: parseDomains(cert),
    daysLeft: daysLeftOf(cert.expiresAt),
    displayStatus: displayStatusOf(cert),
    hostCertPath: toHostPath(cert.certPath),
    hostKeyPath: toHostPath(cert.keyPath),
    deployTargets: targetsOf(cert),
  };
}
