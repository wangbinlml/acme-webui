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
  /** 凭据获取指引（显示在添加/编辑弹窗，帮助配置人员直达控制台） */
  helpUrl?: string;
  helpText?: string;
}

export const PROVIDERS: ProviderTypeDef[] = [
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    dnsAlias: 'dns_cf',
    testable: true,
    helpUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    helpText: 'My Profile → API Tokens → 创建令牌（选「编辑区域 DNS」模板）；Account ID / Zone ID 在域名概览页右侧',
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
    helpUrl: 'https://console.dnspod.cn/account/token/token',
    helpText: 'DNSPod 控制台 → 账号中心 → 密钥管理器 → 创建 API 密钥，得到 ID 和 Token（腾讯云账号可直接登录）',
    fields: [
      { key: 'DP_Id', label: 'ID', required: true, secret: true, placeholder: '密钥管理器中显示的 ID' },
      { key: 'DP_Key', label: 'Token', required: true, secret: true, placeholder: '密钥管理器中显示的 Token' },
    ],
  },
  {
    id: 'aliyun',
    label: '阿里云 DNS',
    dnsAlias: 'dns_ali',
    testable: false,
    helpUrl: 'https://ram.console.aliyun.com/manage/ak',
    helpText: '阿里云控制台 → AccessKey 管理 → 创建 AccessKey（建议使用仅授权云解析 DNS 的 RAM 子账号）',
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
    helpUrl: 'https://console.huaweicloud.com/iam/?locale=zh-cn#/mine/accessKey',
    helpText: '华为云控制台 → 我的凭证，创建 IAM 用户（授权 DNS Administrator）后使用其用户名 / 密码；Project ID 在「我的凭证」项目列表中',
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
    helpUrl: 'https://developer.godaddy.com/keys',
    helpText: 'GoDaddy Developer Portal → API Keys → Create New Key（生产环境 Key + Secret）',
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
    helpUrl: 'https://ap.www.namecheap.com/settings/tools/apiaccess/',
    helpText: 'Namecheap → Account → Tools → API Access，开启后复制 API Key，并把服务器 IP 加入白名单',
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
    helpUrl: 'https://console.aws.amazon.com/iam/',
    helpText: 'AWS IAM 创建用户（编程访问），附加 AmazonRoute53FullAccess 权限后使用其 Access Key',
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
      // 与 acme.sh dns_dp 一致使用规范 action（带点号）；非规范路径部分网关会返回 404
      const body = new URLSearchParams({ login_token: `${id},${key}`, format: 'json' });
      const res = await fetch('https://dnsapi.cn/Domain.List', {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => null)) as
        | { status?: { code?: string; message?: string }; info?: { domain_total?: string } }
        | null;
      if (json?.status?.code === '1') {
        return { ok: true, message: `连接成功，该密钥可管理 ${json.info?.domain_total ?? '?'} 个域名` };
      }
      return { ok: false, message: json?.status?.message ?? `DNSPod API 返回 HTTP ${res.status}` };
    }

    const def = getProviderDef(type);
    if (!def) return { ok: false, message: `未知的 Provider 类型：${type}` };
    return { ok: false, message: `${def.label} 暂不支持在线测试，凭据将在签发证书时验证` };
  } catch (err) {
    return { ok: false, message: `测试请求失败：${err instanceof Error ? err.message : String(err)}` };
  }
}
