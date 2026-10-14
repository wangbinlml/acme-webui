import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates, dnsProviders } from '../db/schema.js';
import { config } from '../config.js';
import { runAcme, tailOfOutput } from './acme.js';
import { logEvent } from './logger.js';
import {
  type Certificate,
  daysLeftOf,
  filesFor,
  isEccKey,
  parseDomains,
  readCertInfo,
} from './certificates.js';
import { getAccountEmail } from './settings.js';
import { getProviderDef } from './dns-providers.js';
import { type NotifyEvent, notifyQuietly } from './notifier.js';
import { sendDailyDigest } from './digest.js';

function now(): string {
  return new Date().toISOString();
}

function getCert(certId: number): Certificate | null {
  return db.select().from(certificates).where(eq(certificates.id, certId)).all()[0] ?? null;
}

function markError(certId: number, message: string): void {
  db.update(certificates)
    .set({ status: 'error', lastError: message, updatedAt: now() })
    .where(eq(certificates.id, certId))
    .run();
}

function baseArgs(): string[] {
  return ['--home', config.acmeHome, '--log', config.acmeLogFile];
}

/** 每个进程内每个 CA 只注册一次账户 */
const accountRegistered = new Set<string>();

async function ensureAccount(ca: string): Promise<void> {
  const email = getAccountEmail();
  if (!email || accountRegistered.has(ca)) return;
  accountRegistered.add(ca);
  try {
    const res = await runAcme(['--register-account', '-m', email, '--server', ca, ...baseArgs()], {
      label: '[account]',
    });
    if (res.code === 0) logEvent('info', `${ca} 账户已注册（${email}）`);
    else logEvent('warn', `${ca} 账户注册未成功，将继续尝试签发`);
  } catch (err) {
    logEvent('warn', `${ca} 账户注册失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

interface DnsEnvResult {
  env: Record<string, string>;
  dnsAlias?: string;
}

async function dnsEnvFor(cert: Certificate): Promise<DnsEnvResult | null> {
  if (cert.challengeType !== 'dns01') return { env: {} };
  if (!cert.dnsProviderId) return null;
  const provider = db.select().from(dnsProviders).where(eq(dnsProviders.id, cert.dnsProviderId)).all()[0];
  if (!provider) return null;
  const def = getProviderDef(provider.type);
  if (!def) return null;
  let env: Record<string, string> = {};
  try {
    env = JSON.parse(provider.credentials) as Record<string, string>;
  } catch {
    return null;
  }
  return { env, dnsAlias: def.dnsAlias };
}

/** 把 acme.sh 内部的证书安装到受管理的稳定目录 storage/certificates/<主域名>/ */
async function installCert(cert: Certificate): Promise<boolean> {
  const files = filesFor(cert);
  fs.mkdirSync(files.dir, { recursive: true });
  const args = ['--install-cert', '-d', cert.primaryDomain];
  if (isEccKey(cert.keyType)) args.push('--ecc');
  args.push(
    '--cert-file', files.cert,
    '--key-file', files.key,
    '--ca-file', files.chain,
    '--fullchain-file', files.fullchain,
    ...baseArgs(),
  );
  try {
    const res = await runAcme(args, { certificateId: cert.id, label: cert.primaryDomain });
    if (res.code !== 0) {
      markError(cert.id, `安装证书失败（acme.sh 退出码 ${res.code}）\n${tailOfOutput(res.output)}`);
      return false;
    }
    // 迁移旧版按数字 id 存放的目录（域名目录不可能是纯数字，可安全区分）
    const legacyDir = path.join(config.certDir, String(cert.id));
    if (legacyDir !== files.dir && fs.existsSync(legacyDir)) {
      try {
        fs.rmSync(legacyDir, { recursive: true, force: true });
      } catch {
        // 清理失败不影响主流程
      }
    }
    return true;
  } catch (err) {
    markError(cert.id, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** 重新解析本地证书文件并更新数据库状态（签发/续期成功后调用） */
function refreshCertState(cert: Certificate): void {
  const files = filesFor(cert);
  const info = readCertInfo({ ...cert, certPath: files.fullchain });
  if (!info) {
    markError(cert.id, '签发流程结束但无法解析证书文件，请查看 acme.sh 日志');
    return;
  }
  db.update(certificates)
    .set({
      status: 'valid',
      issuedAt: info.validFrom ?? now(),
      expiresAt: info.validTo ?? null,
      certPath: files.fullchain,
      keyPath: files.key,
      lastError: null,
      updatedAt: now(),
    })
    .where(eq(certificates.id, cert.id))
    .run();
}

/** 签发流程（force=true 时为「重新签发」）。永不抛异常，返回是否成功。结束后推送通知。 */
export async function issueFlow(certId: number, opts: { force: boolean }): Promise<boolean> {
  const ok = await issueFlowInner(certId, opts);
  const cert = getCert(certId);
  if (cert) await notifyResult(cert, ok, opts.force ? 'reissue' : 'issue');
  return ok;
}

async function issueFlowInner(certId: number, opts: { force: boolean }): Promise<boolean> {
  const cert = getCert(certId);
  if (!cert) return false;
  const domains = parseDomains(cert);

  if (cert.ca === 'zerossl' && !getAccountEmail()) {
    markError(certId, '使用 ZeroSSL 需要先在「设置」中填写账户邮箱');
    logEvent('error', `${cert.primaryDomain} 签发失败：未配置 ZeroSSL 账户邮箱`, certId);
    return false;
  }

  const args: string[] = ['--issue'];
  for (const d of domains) args.push('-d', d);
  args.push('--server', cert.ca, '--keylength', cert.keyType);
  if (opts.force) args.push('--force');

  const dns = await dnsEnvFor(cert);
  if (cert.challengeType === 'dns01') {
    if (!dns?.dnsAlias) {
      markError(certId, 'DNS Provider 不存在或凭据损坏，请检查 DNS API 配置');
      logEvent('error', `${cert.primaryDomain} 签发失败：DNS Provider 配置无效`, certId);
      return false;
    }
    args.push('--dns', dns.dnsAlias);
  } else {
    args.push('--standalone');
  }
  args.push(...baseArgs());

  await ensureAccount(cert.ca);
  logEvent('info', `开始${opts.force ? '重新签发' : '签发'} ${cert.primaryDomain}（${domains.join(', ')}）`, certId);

  try {
    const res = await runAcme(args, { env: dns?.env ?? {}, certificateId: certId, label: cert.primaryDomain });
    if (res.code !== 0) {
      markError(certId, `acme.sh 退出码 ${res.code}\n${tailOfOutput(res.output)}`);
      logEvent('error', `${cert.primaryDomain} ${opts.force ? '重新签发' : '签发'}失败`, certId);
      return false;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markError(certId, message);
    logEvent('error', `${cert.primaryDomain} 签发失败：${message}`, certId);
    return false;
  }

  if (!(await installCert(cert))) return false;
  refreshCertState(cert);
  const updated = getCert(certId);
  const expires = updated?.expiresAt ? new Date(updated.expiresAt).toISOString().slice(0, 10) : '未知';
  logEvent('info', `${cert.primaryDomain} ${opts.force ? '重新签发' : '签发'}成功，有效期至 ${expires}`, certId);
  return true;
}

const CA_LABELS: Record<string, string> = { letsencrypt: "Let's Encrypt", zerossl: 'ZeroSSL' };

/** 签发/续期结束（无论成败）向所有已配置渠道推送通知 */
async function notifyResult(cert: Certificate, ok: boolean, kind: 'issue' | 'reissue' | 'renew'): Promise<void> {
  const ca = CA_LABELS[cert.ca] ?? cert.ca;
  const domains = parseDomains(cert);
  const what = kind === 'renew' ? '续期' : kind === 'reissue' ? '重新签发' : '签发';
  const event = `cert.${kind === 'renew' ? 'renew' : 'issue'}.${ok ? 'success' : 'failed'}` as NotifyEvent['event'];
  const ev: NotifyEvent = ok
    ? {
        event,
        title: `✅ [Acme Manager] 证书${what}成功`,
        message: [
          `域名：${domains.join('、')}`,
          `CA：${ca}`,
          `到期时间：${cert.expiresAt ? cert.expiresAt.slice(0, 10) : '未知'}${
            daysLeftOf(cert.expiresAt) !== null ? `（剩余 ${daysLeftOf(cert.expiresAt)} 天）` : ''
          }`,
        ].join('\n'),
        ok: true,
        domain: cert.primaryDomain,
        domains,
        ca: cert.ca,
        expiresAt: cert.expiresAt ?? undefined,
      }
    : {
        event,
        title: `❌ [Acme Manager] 证书${what}失败`,
        message: [
          `域名：${domains.join('、')}`,
          `CA：${ca}`,
          `错误：${(cert.lastError ?? '未知错误').split('\n')[0].slice(0, 300)}`,
          '请到管理面板查看详情并手动处理',
        ].join('\n'),
        ok: false,
        domain: cert.primaryDomain,
        domains,
        ca: cert.ca,
        error: (cert.lastError ?? '未知错误').split('\n')[0].slice(0, 300),
      };
  await notifyQuietly(ev, cert.id);
}

/** 立即续期（--force，由本系统的阈值逻辑决定何时续） */
export async function renewFlow(certId: number): Promise<boolean> {
  const ok = await renewFlowInner(certId);
  const cert = getCert(certId);
  if (cert) await notifyResult(cert, ok, 'renew');
  return ok;
}

async function renewFlowInner(certId: number): Promise<boolean> {
  const cert = getCert(certId);
  if (!cert) return false;

  const dns = await dnsEnvFor(cert);
  if (cert.challengeType === 'dns01' && !dns?.dnsAlias) {
    markError(certId, 'DNS Provider 不存在或凭据损坏，请检查 DNS API 配置');
    logEvent('error', `${cert.primaryDomain} 续期失败：DNS Provider 配置无效`, certId);
    return false;
  }

  const args = ['--renew', '-d', cert.primaryDomain, '--force'];
  if (isEccKey(cert.keyType)) args.push('--ecc');
  args.push(...baseArgs());

  logEvent('info', `开始续期 ${cert.primaryDomain}`, certId);
  try {
    const res = await runAcme(args, { env: dns?.env ?? {}, certificateId: certId, label: cert.primaryDomain });
    if (res.code !== 0) {
      markError(certId, `acme.sh 退出码 ${res.code}\n${tailOfOutput(res.output)}`);
      logEvent('error', `${cert.primaryDomain} 续期失败`, certId);
      return false;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markError(certId, message);
    logEvent('error', `${cert.primaryDomain} 续期失败：${message}`, certId);
    return false;
  }

  if (!(await installCert(cert))) return false;
  refreshCertState(cert);
  const updated = getCert(certId);
  const expires = updated?.expiresAt ? new Date(updated.expiresAt).toISOString().slice(0, 10) : '未知';
  logEvent('info', `${cert.primaryDomain} 续期成功，新有效期至 ${expires}`, certId);
  return true;
}

/** 删除证书：可选先向 CA 吊销，再移除 acme.sh 记录、本地文件与数据库记录 */
export async function removeFlow(
  cert: Certificate,
  opts?: { revoke?: boolean },
): Promise<{ revoked: boolean; revokeError?: string }> {
  const result = { revoked: false, revokeError: undefined as string | undefined };

  // 吊销（向 CA 发送 revoke 请求，使证书立即失效）
  if (opts?.revoke) {
    try {
      const args = ['--revoke', '-d', cert.primaryDomain];
      if (isEccKey(cert.keyType)) args.push('--ecc');
      args.push(...baseArgs());
      const res = await runAcme(args, { label: cert.primaryDomain });
      if (res.code === 0) {
        result.revoked = true;
        logEvent('warn', `已向 CA 吊销 ${cert.primaryDomain}`, cert.id);
      } else {
        result.revokeError = `acme.sh 退出码 ${res.code}`;
        logEvent('warn', `吊销 ${cert.primaryDomain} 未成功（${result.revokeError}），继续删除本地记录`, cert.id);
      }
    } catch (err) {
      result.revokeError = err instanceof Error ? err.message : String(err);
      logEvent('warn', `吊销 ${cert.primaryDomain} 失败：${result.revokeError}，继续删除本地记录`, cert.id);
    }
  }

  try {
    const args = ['--remove', '-d', cert.primaryDomain];
    if (isEccKey(cert.keyType)) args.push('--ecc');
    args.push(...baseArgs());
    const res = await runAcme(args, { label: cert.primaryDomain });
    if (res.code !== 0) logEvent('warn', `从 acme.sh 移除 ${cert.primaryDomain} 未成功（忽略，继续删除本地记录）`, cert.id);
  } catch (err) {
    logEvent('warn', `从 acme.sh 移除 ${cert.primaryDomain} 失败：${err instanceof Error ? err.message : String(err)}`, cert.id);
  }
  try {
    fs.rmSync(filesFor(cert).dir, { recursive: true, force: true });
    // 同时清理旧版按数字 id 存放的目录（若有）
    fs.rmSync(path.join(config.certDir, String(cert.id)), { recursive: true, force: true });
  } catch {
    // 目录不存在时忽略
  }
  db.delete(certificates).where(eq(certificates.id, cert.id)).run();
  logEvent('info', `已删除证书 ${cert.primaryDomain}${result.revoked ? '（已向 CA 吊销）' : ''}`, cert.id);
  return result;
}

/** 续期扫描：到期前 renewBeforeDays 天内的证书逐个续期 */
export async function runRenewalScan(trigger: 'cron' | 'manual'): Promise<void> {
  logEvent('info', `开始检查证书（${trigger === 'cron' ? '定时任务' : '手动触发'}）`);
  const certs = db.select().from(certificates).all();
  let renewed = 0;
  let failed = 0;
  let checked = 0;

  for (const cert of certs) {
    if (!cert.autoRenew) continue;
    if (cert.status === 'issuing') continue;
    const left = daysLeftOf(cert.expiresAt);
    if (left === null) continue;
    checked += 1;
    if (left > cert.renewBeforeDays) continue;

    logEvent('info', `${cert.primaryDomain} 剩余 ${left} 天（阈值 ${cert.renewBeforeDays} 天），开始续期`, cert.id);
    db.update(certificates).set({ status: 'issuing', updatedAt: now() }).where(eq(certificates.id, cert.id)).run();
    const ok = await renewFlow(cert.id);
    if (ok) renewed += 1;
    else failed += 1;
  }

  logEvent(
    failed > 0 ? 'warn' : 'info',
    `检查完成：待续期 ${checked} 个，成功 ${renewed} 个${failed > 0 ? `，失败 ${failed} 个` : ''}`,
  );

  // 每日巡检汇总只随定时扫描发送；手动触发时用户就在看 UI，不再推送
  if (trigger === 'cron') await sendDailyDigest();
}
