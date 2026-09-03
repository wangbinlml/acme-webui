import type {
  AuthUser,
  CertificateView,
  CertInfo,
  DashboardData,
  DnsProviderView,
  NotifyTestResult,
  PersistedLog,
  ProviderTypeDef,
  SettingsData,
  UserView,
} from './types';

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
    let message = `请求失败（HTTP ${res.status}）`;
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
  renewCert: (id: number) =>
    request<{ certificate: CertificateView }>(`/api/certificates/${id}/renew`, { method: 'POST' }),
  reissueCert: (id: number) =>
    request<{ certificate: CertificateView }>(`/api/certificates/${id}/reissue`, { method: 'POST' }),
  updateCert: (id: number, patch: { autoRenew?: boolean; renewBeforeDays?: number }) =>
    request<{ certificate: CertificateView }>(`/api/certificates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteCert: (id: number) => request<{ ok: boolean }>(`/api/certificates/${id}`, { method: 'DELETE' }),
  saveDeploy: (
    id: number,
    payload: { enabled: boolean; mode: string; targetDir: string; cmd: string; container: string },
  ) =>
    request<{ certificate: CertificateView }>(`/api/certificates/${id}/deploy`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  runDeploy: (id: number) =>
    request<{ ok: boolean; message: string; certificate: CertificateView }>(`/api/certificates/${id}/deploy/run`, {
      method: 'POST',
    }),

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

  getSettings: () => request<SettingsData>('/api/settings'),
  saveSettings: (payload: {
    accountEmail: string;
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
