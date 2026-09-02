export type DisplayStatus = 'issuing' | 'ok' | 'expiring' | 'expired' | 'error';

export type UserRole = 'admin' | 'viewer';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
}

export interface UserView extends AuthUser {
  createdAt: string;
}

export interface CertificateView {
  id: number;
  primaryDomain: string;
  domains: string[];
  ca: string;
  keyType: string;
  challengeType: 'http01' | 'dns01';
  dnsProviderId: number | null;
  status: string;
  autoRenew: boolean;
  renewBeforeDays: number;
  certPath: string | null;
  keyPath: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface DashboardStats {
  total: number;
  ok: number;
  expiring: number;
  expired: number;
  error: number;
  issuing: number;
}

export interface DashboardData {
  stats: DashboardStats;
  recent: CertificateView[];
}

export interface ProviderFieldDef {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
}

export interface ProviderTypeDef {
  id: string;
  label: string;
  dnsAlias: string;
  fields: ProviderFieldDef[];
  testable: boolean;
}

export interface DnsProviderView {
  id: number;
  name: string;
  type: string;
  typeName: string;
  testable: boolean;
  credentials: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface LogLine {
  ts: string;
  level: 'info' | 'warn' | 'error';
  source: 'system' | 'acme';
  message: string;
  certificateId?: number | null;
}

export interface PersistedLog {
  id: number;
  level: string;
  message: string;
  certificateId: number | null;
  domain: string | null;
  createdAt: string;
}

export interface NotifySettings {
  channel: '' | 'wecom' | 'feishu';
  /** 已保存的地址会脱敏显示（key 只留末 4 位）；提交时传回脱敏哨兵表示不变更 */
  webhook: string;
  feishuSecret: string;
}

export interface SettingsData {
  accountEmail: string;
  renewCron: string;
  acmeBin: string;
  acmeAvailable: boolean;
  version: string;
  notify: NotifySettings;
}
