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
  /** 宿主机视角的路径；与 certPath 相同表示非容器部署或未识别到挂载 */
  hostCertPath: string | null;
  hostKeyPath: string | null;
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
  /** 凭据获取指引（控制台直达链接 + 说明） */
  helpUrl?: string;
  helpText?: string;
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
  robot: { channel: '' | 'wecom' | 'feishu'; webhook: string; feishuSecret: string };
  webhook: { url: string };
  smtp: { host: string; port: number; user: string; from: string; to: string; password: string };
}

export interface NotifyTestResult {
  channel: 'robot' | 'webhook' | 'smtp';
  ok: boolean;
  error?: string;
}

export interface SettingsData {
  accountEmail: string;
  renewCron: string;
  acmeBin: string;
  acmeAvailable: boolean;
  version: string;
  logRetentionDays: number;
  hasDistributeToken: boolean;
  notify: NotifySettings;
}

export interface DistributeTarget {
  id: number;
  primaryDomain: string;
  ip: string;
  reloadMode: string | null;
  container: string | null;
  certDir: string | null;
  firstSeenAt: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  syncCount: number;
  tags: string[];
  stale: boolean;
  hostname: string | null;
  lastProbeAt: string | null;
  lastProbeStatus: string | null;
  lastProbeMessage: string | null;
  certStatus?: string | null;
  certExpiresAt?: string | null;
  certId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: number;
  username: string;
  action: string;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}
