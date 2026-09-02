import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates, dnsProviders } from '../db/schema.js';
import { enqueue } from '../services/queue.js';
import { issueFlow, renewFlow, removeFlow } from '../services/cert-ops.js';
import { filesFor, isValidDomain, readCertInfo, toView } from '../services/certificates.js';
import { logEvent } from '../services/logger.js';
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
    void enqueue(() => issueFlow(row.id, { force: false }));
    return reply.code(201).send({ certificate: toView(row) });
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
    return { certificate: toView(getCertOrNull(cert.id) ?? cert) };
  });

  app.delete<{ Params: { id: string } }>('/certificates/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const cert = id ? getCertOrNull(id) : null;
    if (!cert) return reply.code(404).send({ error: '证书不存在' });
    if (cert.status === 'issuing') return reply.code(409).send({ error: '该证书正在执行任务，无法删除' });
    await removeFlow(cert);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/certificates/:id/download', async (req, reply) => {
    const id = parseId(req.params.id);
    const cert = id ? getCertOrNull(id) : null;
    if (!cert) return reply.code(404).send({ error: '证书不存在' });
    const type = String((req.query as { type?: string }).type ?? 'fullchain');
    const files = filesFor(cert.id);
    const file =
      type === 'key' ? files.key : type === 'cert' ? files.cert : type === 'ca' ? files.chain : files.fullchain;
    if (!fs.existsSync(file)) {
      return reply.code(404).send({ error: '证书文件不存在（证书可能尚未签发成功）' });
    }
    reply.header('content-disposition', `attachment; filename="${cert.primaryDomain}-${type}.pem"`);
    reply.header('content-type', 'application/x-pem-file');
    return reply.send(fs.createReadStream(file));
  });
}
