import type {
  AuthUser,
  AuditLog,
  CertificateView,
  CertInfo,
  DashboardData,
  DnsProviderView,
  DistributeTarget,
  NotifyTestResult,
  PersistedLog,
  ProviderTypeDef,
  SettingsData,
  UserView,
} from './types';
import i18n from './locales';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 无 body 的 POST/DELETE 不能声明 json content-type，否则 Fastify 报空 JSON body 400
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    // 会话过期：除登录页外统一跳登录页（带当前路径，登录后回来）
    if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
      window.location.assign(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    let message = i18n.global.t('common.requestFailed', { status: res.status });
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // 非 JSON 响应体
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export interface CreateCertPayload {
  primaryDomain: string;
  sanDomains: string[];
  ca: string;
  keyType: string;
  challengeType: string;
  dnsProviderId?: number;
  autoRenew: boolean;
  renewBeforeDays: number;
}

export const api = {
  dashboard: () => request<DashboardData>('/api/dashboard'),
  listCerts: () => request<{ certificates: CertificateView[] }>('/api/certificates'),
  getCert: (id: number) =>
    request<{ certificate: CertificateView; certInfo: CertInfo | null }>(`/api/certificates/${id}`),
  createCert: (payload: CreateCertPayload) =>
    request<{ certificate: CertificateView }>('/api/certificates', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  importCert: (payload: { fullchain: string; privkey: string; autoRenew?: boolean; renewBeforeDays?: number }) =>
    request<{ certificate: CertificateView }>('/api/certificates/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  renewCert: (id: number) =>
    request<{ certificate: CertificateView }>(`/api/certificates/${id}/renew`, { method: 'POST' }),
  reissueCert: (id: number) =>
    request<{ certificate: CertificateView }>(`/api/certificates/${id}/reissue`, { method: 'POST' }),
  updateCert: (id: number, patch: { autoRenew?: boolean; renewBeforeDays?: number }) =>
    request<{ certificate: CertificateView }>(`/api/certificates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCert: (id: number, revoke?: boolean) =>
    request<{ ok: boolean; revoked?: boolean; revokeError?: string }>(
      `/api/certificates/${id}${revoke ? '?revoke=true' : ''}`,
      { method: 'DELETE' },
    ),

  providerTypes: () => request<{ types: ProviderTypeDef[] }>('/api/dns-provider-types'),
  listProviders: () => request<{ providers: DnsProviderView[] }>('/api/dns-providers'),
  createProvider: (payload: { name: string; type: string; credentials: Record<string, string> }) =>
    request<{ provider: DnsProviderView }>('/api/dns-providers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateProvider: (id: number, payload: { name?: string; credentials?: Record<string, string> }) =>
    request<{ provider: DnsProviderView }>(`/api/dns-providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteProvider: (id: number) => request<{ ok: boolean }>(`/api/dns-providers/${id}`, { method: 'DELETE' }),
  testProvider: (payload: { providerId?: number; type?: string; credentials?: Record<string, string> }) =>
    request<{ ok: boolean; message: string }>('/api/dns-providers/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listLogs: (params: { limit?: number; level?: string; certificateId?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.level) qs.set('level', params.level);
    if (params.certificateId) qs.set('certificateId', String(params.certificateId));
    const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
    return request<{ logs: PersistedLog[] }>(`/api/logs${suffix}`);
  },
  cleanupLogs: () =>
    request<{ ok: boolean; message: string; logsDeleted: number; sessionsPurged: number; acmeLogRotated: boolean }>(
      '/api/logs/cleanup',
      { method: 'POST' },
    ),

  getSettings: () => request<SettingsData>('/api/settings'),
  saveSettings: (payload: {
    accountEmail?: string;
    logRetentionDays?: number;
    notify?: {
      robot?: { channel: string; webhook: string; feishuSecret: string };
      webhook?: { url: string };
      smtp?: { host: string; port: number; user: string; password: string; from: string; to: string };
    };
  }) => request<{ ok: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testNotify: (channel?: 'robot' | 'webhook' | 'smtp') =>
    request<{ ok: boolean; message: string; results: NotifyTestResult[] }>('/api/settings/notify/test', {
      method: 'POST',
      body: JSON.stringify(channel ? { channel } : {}),
    }),
  restoreBackup: (file: File) =>
    request<{ ok: boolean; message: string }>('/api/settings/restore', {
      method: 'POST',
      // 原始字节流上传，必须显式声明，避免 request() 默认套 application/json
      headers: { 'content-type': 'application/gzip' },
      body: file,
    }),
  getDistributeToken: () => request<{ token: string | null }>('/api/distribute/token'),
  createDistributeToken: () => request<{ token: string }>('/api/distribute/token', { method: 'POST' }),
  revokeDistributeToken: () => request<{ ok: boolean }>('/api/distribute/token', { method: 'DELETE' }),
  listDistributeTargets: (domain: string) =>
    request<{ targets: DistributeTarget[] }>(`/api/distribute/targets?domain=${encodeURIComponent(domain)}`),
  listAllDistributeTargets: () =>
    request<{ targets: DistributeTarget[] }>('/api/distribute/targets'),
  deleteDistributeTarget: (id: number) =>
    request<{ ok: boolean }>(`/api/distribute/targets/${id}`, { method: 'DELETE' }),
  updateDistributeTargetTags: (id: number, tags: string[]) =>
    request<{ ok: boolean }>(`/api/distribute/targets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags }),
    }),
  probeDistributeTarget: (id: number, port?: number) =>
    request<{ status: string; message: string; probeAt: string }>(
      `/api/distribute/targets/${id}/probe${port ? `?port=${port}` : ''}`,
      { method: 'POST' },
    ),
  listAuditLogs: (params: { limit?: number; username?: string; action?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.username) qs.set('username', params.username);
    if (params.action) qs.set('action', params.action);
    const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
    return request<{ logs: AuditLog[] }>(`/api/audit${suffix}`);
  },
  listAuditActions: () => request<{ actions: string[] }>('/api/audit/actions'),
  runRenewScan: () => request<{ started: boolean; message: string }>('/api/renew/run', { method: 'POST' }),

  health: () => request<{ ok: boolean; version: string; acmeAvailable: boolean }>('/api/health'),
  authStatus: () => request<{ needsSetup: boolean }>('/api/auth/status'),
  setup: (payload: { username: string; password: string }) =>
    request<{ user: AuthUser }>('/api/auth/setup', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: { username: string; password: string }) =>
    request<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: AuthUser | null }>('/api/auth/me'),
  changePassword: (payload: { oldPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>('/api/auth/password', { method: 'PUT', body: JSON.stringify(payload) }),
  listUsers: () => request<{ users: UserView[] }>('/api/users'),
  createUser: (payload: { username: string; password: string; role: string }) =>
    request<{ user: AuthUser }>('/api/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: number, patch: { role?: string; password?: string }) =>
    request<{ ok: boolean }>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),
};
