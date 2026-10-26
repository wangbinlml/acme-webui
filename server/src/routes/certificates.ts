import fs from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates, dnsProviders } from '../db/schema.js';
import { enqueue } from '../services/queue.js';
import { issueFlow, renewFlow, removeFlow } from '../services/cert-ops.js';
import { filesFor, isValidDomain, parseCertPem, readCertInfo, toView } from '../services/certificates.js';
import { logEvent } from '../services/logger.js';
import { logAudit } from '../services/audit.js';
import { getAccountEmail } from '../services/settings.js';

const CAS = ['letsencrypt', 'zerossl'] as const;
const KEY_TYPES = ['rsa-2048', 'ec-256', 'ec-384'] as const;

function getCertOrNull(id: number) {
  return db.select().from(certificates).where(eq(certificates.id, id)).all()[0] ?? null;
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function certificateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/certificates', async () => {
    const rows = db.select().from(certificates).orderBy(desc(certificates.createdAt)).all();
    return { certificates: rows.map(toView) };
  });

  app.get<{ Params: { id: string } }>('/certificates/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const cert = id ? getCertOrNull(id) : null;
    if (!cert) return reply.code(404).send({ error: '证书不存在' });
    return { certificate: toView(cert), certInfo: readCertInfo(cert) };
  });

  app.post('/certificates', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const primaryDomain = String(body.primaryDomain ?? '').trim().toLowerCase();
    if (!primaryDomain) return reply.code(400).send({ error: '请填写主域名' });
    if (!isValidDomain(primaryDomain)) {
      return reply.code(400).send({ error: `主域名格式不正确：${primaryDomain}` });
    }

    const sanRaw = Array.isArray(body.sanDomains) ? body.sanDomains : [];
    const sanDomains = [...new Set(sanRaw.map((d) => String(d).trim().toLowerCase()).filter(Boolean))]
      .filter((d) => d !== primaryDomain);
    for (const d of sanDomains) {
      if (!isValidDomain(d)) return reply.code(400).send({ error: `SAN 域名格式不正确：${d}` });
    }

    const ca = String(body.ca ?? 'letsencrypt');
    if (!CAS.includes(ca as (typeof CAS)[number])) return reply.code(400).send({ error: '不支持的 CA' });
    const keyType = String(body.keyType ?? 'ec-256');
    if (!KEY_TYPES.includes(keyType as (typeof KEY_TYPES)[number])) {
      return reply.code(400).send({ error: '不支持的密钥算法' });
    }
    const challengeType = String(body.challengeType ?? 'dns01');
    if (!['http01', 'dns01'].includes(challengeType)) {
      return reply.code(400).send({ error: '不支持的验证方式' });
    }

    const hasWildcard = [primaryDomain, ...sanDomains].some((d) => d.startsWith('*.'));
    if (hasWildcard && challengeType !== 'dns01') {
      return reply.code(400).send({ error: '通配符证书必须使用 DNS-01 验证' });
    }

    let dnsProviderId: number | null = null;
    if (challengeType === 'dns01') {
      dnsProviderId = Number(body.dnsProviderId ?? 0);
      if (!dnsProviderId) return reply.code(400).send({ error: 'DNS-01 验证需要选择 DNS Provider' });
      const provider = db.select().from(dnsProviders).where(eq(dnsProviders.id, dnsProviderId)).all()[0];
      if (!provider) return reply.code(400).send({ error: 'DNS Provider 不存在' });
    }

    if (ca === 'zerossl' && !getAccountEmail()) {
      return reply.code(400).send({ error: '使用 ZeroSSL 前请先在「设置」中配置账户邮箱' });
    }

    const renewBeforeDays = Math.min(Math.max(Number(body.renewBeforeDays ?? 30) || 30, 1), 89);
    const autoRenew = body.autoRenew !== false;
    const ts = new Date().toISOString();

    const row = db
      .insert(certificates)
      .values({
        primaryDomain,
        domains: JSON.stringify([primaryDomain, ...sanDomains]),
        ca,
        keyType,
        challengeType,
        dnsProviderId,
        status: 'issuing',
        autoRenew,
        renewBeforeDays,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
      .all()[0];

    logEvent('info', `创建证书 ${primaryDomain}，开始签发`, row.id);
    logAudit(req, 'cert.create', `创建证书 ${primaryDomain}（${ca} / ${keyType} / ${challengeType}）`);
    void enqueue(() => issueFlow(row.id, { force: false }));
    return reply.code(201).send({ certificate: toView(row) });
  });

  app.post('/certificates/import', async (req, reply) => {
    const body = (req.body ?? {}) as { fullchain?: string; privkey?: string; autoRenew?: boolean; renewBeforeDays?: number };
    const fullchain = String(body.fullchain ?? '').trim();
    const privkey = String(body.privkey ?? '').trim();
    if (!fullchain || !privkey) {
      return reply.code(400).send({ error: '需要提供 fullchain 和 privkey PEM 内容' });
    }
    if (!fullchain.includes('BEGIN CERTIFICATE') || !privkey.includes('PRIVATE KEY')) {
      return reply.code(400).send({ error: 'PEM 内容格式不正确（fullchain 需含 BEGIN CERTIFICATE，privkey 需含 PRIVATE KEY）' });
    }

    let info;
    try {
      info = parseCertPem(fullchain);
    } catch {
      return reply.code(400).send({ error: '无法解析证书，请检查 fullchain PEM 内容' });
    }

    // 从 CN 或 SAN 推断主域名
    const cn = info.subject.match(/CN=([^,\n]+)/)?.[1]?.trim() ?? '';
    const primaryDomain = (cn || info.sans[0] || '').toLowerCase();
    if (!primaryDomain || !isValidDomain(primaryDomain)) {
      return reply.code(400).send({ error: '无法从证书中识别有效域名，请手动创建' });
    }

    // 从 Issuer 推断 CA
    const issuer = info.issuer.toLowerCase();
    const ca = issuer.includes("let's encrypt") || issuer.includes('r3') || issuer.includes('r10') || issuer.includes('r11')
      ? 'letsencrypt'
      : issuer.includes('zerossl')
        ? 'zerossl'
        : 'imported';

    // 从私钥推断密钥算法
    let keyType = 'rsa-2048';
    try {
      const key = createPrivateKey(privkey);
      if (key.asymmetricKeyType === 'ec') {
        const curve = (key.asymmetricKeyDetails as { namedCurve?: string } | undefined)?.namedCurve;
        keyType = curve === 'secp384r1' ? 'ec-384' : 'ec-256';
      } else if (key.asymmetricKeyType === 'rsa') {
        keyType = 'rsa-2048';
      }
    } catch {
      // 无法检测则默认 rsa-2048
    }

    const domains = [primaryDomain, ...info.sans.filter((s) => s.toLowerCase() !== primaryDomain)];
    const renewBeforeDays = Math.min(Math.max(Number(body.renewBeforeDays ?? 30) || 30, 1), 89);
    const autoRenew = body.autoRenew === true;
    const ts = new Date().toISOString();

    const row = db
      .insert(certificates)
      .values({
        primaryDomain,
        domains: JSON.stringify(domains),
        ca,
        keyType,
        challengeType: 'imported',
        status: 'valid',
        autoRenew,
        renewBeforeDays,
        issuedAt: info.validFrom,
        expiresAt: info.validTo,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
      .all()[0];

    // 保存证书文件到受管理目录
    const files = filesFor({ id: row.id, primaryDomain });
    fs.mkdirSync(files.dir, { recursive: true });
    fs.writeFileSync(files.fullchain, fullchain);
    fs.writeFileSync(files.key, privkey);
    fs.writeFileSync(files.cert, fullchain.split('-----END CERTIFICATE-----')[0] + '-----END CERTIFICATE-----\n');
    db.update(certificates)
      .set({ certPath: files.fullchain, keyPath: files.key, updatedAt: new Date().toISOString() })
      .where(eq(certificates.id, row.id))
      .run();

    logEvent('info', `导入证书 ${primaryDomain}（CA: ${ca}，到期 ${info.validTo ?? '未知'}）`, row.id);
    logAudit(req, 'cert.import', `导入证书 ${primaryDomain}（CA: ${ca}）`);
    return reply.code(201).send({ certificate: toView(getCertOrNull(row.id) ?? row) });
  });

  app.post<{ Params: { id: string } }>('/certificates/:id/renew', async (req, reply) => {
    const id = parseId(req.params.id);
    const cert = id ? getCertOrNull(id) : null;
    if (!cert) return reply.code(404).send({ error: '证书不存在' });
    if (cert.status === 'issuing') return reply.code(409).send({ error: '该证书正在执行任务，请稍候' });
    db.update(certificates)
      .set({ status: 'issuing', updatedAt: new Date().toISOString() })
      .where(eq(certificates.id, cert.id))
      .run();
    logAudit(req, 'cert.renew', `提交续期 ${cert.primaryDomain}`);
    void enqueue(() => renewFlow(cert.id));
    return { certificate: toView(getCertOrNull(cert.id) ?? cert) };
  });

  app.post<{ Params: { id: string } }>('/certificates/:id/reissue', async (req, reply) => {
    const id = parseId(req.params.id);
    const cert = id ? getCertOrNull(id) : null;
    if (!cert) return reply.code(404).send({ error: '证书不存在' });
    if (cert.status === 'issuing') return reply.code(409).send({ error: '该证书正在执行任务，请稍候' });
    db.update(certificates)
      .set({ status: 'issuing', updatedAt: new Date().toISOString() })
      .where(eq(certificates.id, cert.id))
      .run();
    logAudit(req, 'cert.reissue', `提交重新签发 ${cert.primaryDomain}`);
    void enqueue(() => issueFlow(cert.id, { force: true }));
    return { certificate: toView(getCertOrNull(cert.id) ?? cert) };
  });

  app.patch<{ Params: { id: string } }>('/certificates/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const cert = id ? getCertOrNull(id) : null;
    if (!cert) return reply.code(404).send({ error: '证书不存在' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (typeof body.autoRenew === 'boolean') patch.autoRenew = body.autoRenew;
    if (body.renewBeforeDays !== undefined) {
      const days = Number(body.renewBeforeDays);
      if (!Number.isInteger(days) || days < 1 || days > 89) {
        return reply.code(400).send({ error: '续期阈值需为 1-89 的整数（单位：天）' });
      }
      patch.renewBeforeDays = days;
    }
    db.update(certificates).set(patch).where(eq(certificates.id, cert.id)).run();
    logAudit(req, 'cert.update', `更新配置 ${cert.primaryDomain}（${Object.keys(patch).filter((k) => k !== 'updatedAt').join('、') || '无变更'}）`);
    return { certificate: toView(getCertOrNull(cert.id) ?? cert) };
  });

  app.delete<{ Params: { id: string } }>('/certificates/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const cert = id ? getCertOrNull(id) : null;
    if (!cert) return reply.code(404).send({ error: '证书不存在' });
    if (cert.status === 'issuing') return reply.code(409).send({ error: '该证书正在执行任务，无法删除' });
    const revoke = (req.query as { revoke?: string })?.revoke === 'true';
    const result = await removeFlow(cert, { revoke });
    logAudit(req, 'cert.delete', `删除证书 ${cert.primaryDomain}${revoke ? (result.revoked ? '（已向 CA 吊销）' : '（吊销未成功）') : ''}`);
    return { ok: true, revoked: result.revoked, revokeError: result.revokeError };
  });

  app.get<{ Params: { id: string } }>('/certificates/:id/download', async (req, reply) => {
    const id = parseId(req.params.id);
    const cert = id ? getCertOrNull(id) : null;
    if (!cert) return reply.code(404).send({ error: '证书不存在' });
    const type = String((req.query as { type?: string }).type ?? 'fullchain');
    const files = filesFor(cert);
    // fullchain/key 优先用数据库记录的路径，兼容旧版数字目录中未迁移的证书
    const file =
      type === 'key'
        ? cert.keyPath ?? files.key
        : type === 'cert'
          ? files.cert
          : type === 'ca'
            ? files.chain
            : cert.certPath ?? files.fullchain;
    if (!fs.existsSync(file)) {
      return reply.code(404).send({ error: '证书文件不存在（证书可能尚未签发成功）' });
    }
    reply.header('content-disposition', `attachment; filename="${cert.primaryDomain}-${type}.pem"`);
    reply.header('content-type', 'application/x-pem-file');
    return reply.send(fs.createReadStream(file));
  });
}
