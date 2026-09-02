import type {
  CertificateView,
  CertInfo,
  DashboardData,
  DnsProviderView,
  PersistedLog,
  ProviderTypeDef,
  SettingsData,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 无 body 的 POST/DELETE 不能声明 json content-type，否则 Fastify 报空 JSON body 400
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
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
  saveSettings: (payload: { accountEmail: string; notify?: { channel: string; webhook: string; feishuSecret: string } }) =>
    request<{ ok: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  testNotify: () =>
    request<{ ok: boolean; message: string }>('/api/settings/notify/test', { method: 'POST' }),
  runRenewScan: () => request<{ started: boolean; message: string }>('/api/renew/run', { method: 'POST' }),
};
