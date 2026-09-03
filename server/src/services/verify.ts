import fs from 'node:fs';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

export interface OnlineVerifyResult {
  /** pass=指纹一致；mismatch=线上证书与本地不一致；skip=无法验证（连接失败等，不算异常） */
  status: 'pass' | 'mismatch' | 'skip';
  detail: string;
}

function firstCertBlock(pem: string): string {
  return `${pem.split('-----END CERTIFICATE-----')[0]}-----END CERTIFICATE-----\n`;
}

function normalizeFingerprint(fp: string): string {
  return fp.replace(/:/g, '').toLowerCase();
}

/** 线上证书的 SAN 是否覆盖 host（通配符 SAN 视为覆盖其子域与裸域） */
function coversHost(sanLine: string | undefined, host: string): boolean {
  if (!sanLine) return false;
  return sanLine
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.toUpperCase().startsWith('DNS:'))
    .some((s) => {
      const d = s.slice(4).toLowerCase();
      return d === host || (d.startsWith('*.') && host.endsWith(d.slice(1)));
    });
}

function connect(host: string, port: number, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => resolve(socket),
    );
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`连接超时（${timeoutMs / 1000}s）`));
    });
  });
}

/**
 * 线上验证（best-effort）：连 <主域名>:443 取线上证书，与本地 fullchain
 * 首张证书比对 SHA-256 指纹，用于确认部署 / reload 后线上已生效。
 * 通配符证书基于去掉 *. 的主域验证；域名不出网 / 443 不可达时返回 skip。
 */
export async function verifyOnlineCert(localFullchain: string, primaryDomain: string): Promise<OnlineVerifyResult> {
  const host = primaryDomain.replace(/^\*\./, '');
  const isWildcard = primaryDomain.startsWith('*.');

  let localFp: string;
  try {
    const pem = fs.readFileSync(localFullchain, 'utf8');
    localFp = normalizeFingerprint(new X509Certificate(firstCertBlock(pem)).fingerprint256);
  } catch {
    return { status: 'skip', detail: '无法读取本地证书文件，跳过线上验证' };
  }

  try {
    const socket = await connect(host, 443, 8000);
    try {
      const peer = socket.getPeerCertificate() as {
        fingerprint256?: string;
        valid_to?: string;
        subjectaltname?: string;
      };
      if (!peer || !peer.fingerprint256) {
        return { status: 'skip', detail: `${host}:443 未返回证书，跳过线上验证` };
      }
      if (normalizeFingerprint(peer.fingerprint256) === localFp) {
        return { status: 'pass', detail: `${host}:443 证书已生效（指纹一致）` };
      }
      const until = peer.valid_to ? new Date(peer.valid_to).toISOString().slice(0, 10) : '未知';
      const why = coversHost(peer.subjectaltname, host)
        ? `线上仍是一份旧证书（有效期至 ${until}），可能服务未成功 reload`
        : `线上证书不包含 ${host}（有效期至 ${until}），可能 vhost / CDN 配置有误`;
      return {
        status: 'mismatch',
        detail: `${host}:443 线上证书与本次部署的不一致：${why}${isWildcard ? '（通配符证书基于主域验证，仅供参考）' : ''}`,
      };
    } finally {
      socket.destroy();
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 'skip', detail: `无法连接 ${host}:443（${reason}），跳过线上验证` };
  }
}
