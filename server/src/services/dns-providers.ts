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
  /** acme.sh 的 dns 插件名 */
  dnsAlias: string;
  fields: ProviderFieldDef[];
  /** 是否支持在线测试连接 */
  testable: boolean;
}

export const PROVIDERS: ProviderTypeDef[] = [
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    dnsAlias: 'dns_cf',
    testable: true,
    fields: [
      { key: 'CF_Token', label: 'API Token', required: true, secret: true, placeholder: '具有 Zone.DNS 编辑权限的 Token' },
      { key: 'CF_Account_ID', label: 'Account ID', required: false, secret: false },
      { key: 'CF_Zone_ID', label: 'Zone ID', required: false, secret: false, placeholder: '留空则自动匹配' },
    ],
  },
  {
    id: 'dnspod',
    label: '腾讯云 DNSPod',
    dnsAlias: 'dns_dp',
    testable: true,
    fields: [
      { key: 'DP_Id', label: 'API ID', required: true, secret: true },
      { key: 'DP_Key', label: 'API Key', required: true, secret: true },
    ],
  },
  {
    id: 'aliyun',
    label: '阿里云 DNS',
    dnsAlias: 'dns_ali',
    testable: false,
    fields: [
      { key: 'Ali_Key', label: 'AccessKey ID', required: true, secret: true },
      { key: 'Ali_Secret', label: 'AccessKey Secret', required: true, secret: true },
    ],
  },
  {
    id: 'huawei',
    label: '华为云',
    dnsAlias: 'dns_huaweicloud',
    testable: false,
    fields: [
      { key: 'HUAWEICLOUD_Username', label: 'IAM 用户名', required: true, secret: true },
      { key: 'HUAWEICLOUD_Password', label: 'IAM 密码', required: true, secret: true },
      { key: 'HUAWEICLOUD_ProjectID', label: 'Project ID', required: false, secret: true },
    ],
  },
  {
    id: 'godaddy',
    label: 'GoDaddy',
    dnsAlias: 'dns_gd',
    testable: false,
    fields: [
      { key: 'GD_Key', label: 'Key', required: true, secret: true },
      { key: 'GD_Secret', label: 'Secret', required: true, secret: true },
    ],
  },
  {
    id: 'namecheap',
    label: 'Namecheap',
    dnsAlias: 'dns_namecheap',
    testable: false,
    fields: [
      { key: 'Namecheap_Username', label: '用户名', required: true, secret: false },
      { key: 'Namecheap_API_Key', label: 'API Key', required: true, secret: true },
    ],
  },
  {
    id: 'route53',
    label: 'AWS Route53',
    dnsAlias: 'dns_aws',
    testable: false,
    fields: [
      { key: 'AWS_ACCESS_KEY_ID', label: 'Access Key ID', required: true, secret: false },
      { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret Access Key', required: true, secret: true },
    ],
  },
];

export function getProviderDef(type: string): ProviderTypeDef | undefined {
  return PROVIDERS.find((p) => p.id === type);
}

export interface TestResult {
  ok: boolean;
  message: string;
}

/** 在线测试 DNS API 凭据（目前支持 Cloudflare / DNSPod，其余在签发时验证） */
export async function testDnsConnection(type: string, credentials: Record<string, string>): Promise<TestResult> {
  try {
    if (type === 'cloudflare') {
      const token = credentials.CF_Token;
      if (!token) return { ok: false, message: '缺少 CF_Token' };
      const res = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=1', {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; errors?: { message?: string }[]; result_info?: { total_count?: number } }
        | null;
      if (json?.success) {
        return { ok: true, message: `连接成功，该 Token 可访问 ${json.result_info?.total_count ?? '?'} 个 Zone` };
      }
      return { ok: false, message: json?.errors?.[0]?.message ?? `Cloudflare API 返回 HTTP ${res.status}` };
    }

    if (type === 'dnspod') {
      const id = credentials.DP_Id;
      const key = credentials.DP_Key;
      if (!id || !key) return { ok: false, message: '缺少 DP_Id 或 DP_Key' };
      const body = new URLSearchParams({ login_token: `${id},${key}`, format: 'json' });
      const res = await fetch('https://dnsapi.cn/UserDetail', {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => null)) as { status?: { code?: string; message?: string } } | null;
      if (json?.status?.code === '1') return { ok: true, message: '连接成功，凭据有效' };
      return { ok: false, message: json?.status?.message ?? `DNSPod API 返回 HTTP ${res.status}` };
    }

    const def = getProviderDef(type);
    if (!def) return { ok: false, message: `未知的 Provider 类型：${type}` };
    return { ok: false, message: `${def.label} 暂不支持在线测试，凭据将在签发证书时验证` };
  } catch (err) {
    return { ok: false, message: `测试请求失败：${err instanceof Error ? err.message : String(err)}` };
  }
}
