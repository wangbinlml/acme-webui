import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates, dnsProviders } from '../db/schema.js';
import { PROVIDERS, getProviderDef, testDnsConnection } from '../services/dns-providers.js';
import { logEvent } from '../services/logger.js';

/** 返回给前端的凭据掩码；PUT 时收到掩码表示“保持原值” */
const MASK = '••••••••';

interface ProviderRow {
  id: number;
  name: string;
  type: string;
  credentials: string;
  createdAt: string;
  updatedAt: string;
}

function toView(row: ProviderRow) {
  const def = getProviderDef(row.type);
  let credentials: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.credentials) as Record<string, unknown>;
    credentials = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, v ? MASK : '']),
    );
  } catch {
    // 凭据损坏时返回空对象，前端会提示重新填写
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    typeName: def?.label ?? row.type,
    testable: def?.testable ?? false,
    credentials,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sanitizeCredentials(
  type: string,
  input: Record<string, unknown>,
  previous?: Record<string, string>,
): { ok: true; credentials: string } | { ok: false; error: string } {
  const def = getProviderDef(type);
  if (!def) return { ok: false, error: `未知的 Provider 类型：${type}` };
  const result: Record<string, string> = {};
  for (const field of def.fields) {
    const raw = input[field.key];
    if (raw === MASK && previous?.[field.key]) {
      result[field.key] = previous[field.key];
      continue;
    }
    const value = String(raw ?? '').trim();
    if (field.required && !value) return { ok: false, error: `请填写 ${field.label}（${field.key}）` };
    if (value) result[field.key] = value;
  }
  return { ok: true, credentials: JSON.stringify(result) };
}

function previousCredentials(row: ProviderRow): Record<string, string> {
  try {
    return JSON.parse(row.credentials) as Record<string, string>;
  } catch {
    return {};
  }
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function dnsProviderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dns-provider-types', async () => ({ types: PROVIDERS }));

  app.get('/dns-providers', async () => {
    const rows = db.select().from(dnsProviders).orderBy(desc(dnsProviders.createdAt)).all();
    return { providers: rows.map((r) => toView(r as ProviderRow)) };
  });

  app.post('/dns-providers', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = String(body.name ?? '').trim();
    const type = String(body.type ?? '').trim();
    if (!name) return reply.code(400).send({ error: '请填写名称' });
    const sanitized = sanitizeCredentials(type, (body.credentials ?? {}) as Record<string, unknown>);
    if (!sanitized.ok) return reply.code(400).send({ error: sanitized.error });
    const ts = new Date().toISOString();
    const row = db
      .insert(dnsProviders)
      .values({ name, type, credentials: sanitized.credentials, createdAt: ts, updatedAt: ts })
      .returning()
      .all()[0];
    logEvent('info', `已添加 DNS Provider「${name}」（${getProviderDef(type)?.label ?? type}）`);
    return reply.code(201).send({ provider: toView(row as ProviderRow) });
  });

  app.put<{ Params: { id: string } }>('/dns-providers/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const row = id ? (db.select().from(dnsProviders).where(eq(dnsProviders.id, id)).all()[0] ?? null) : null;
    if (!row) return reply.code(404).send({ error: 'DNS Provider 不存在' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.type === 'string' && body.type && body.type !== row.type) {
      return reply.code(400).send({ error: '不支持修改 Provider 类型，请删除后重新添加' });
    }
    if (body.credentials !== undefined) {
      const sanitized = sanitizeCredentials(
        row.type,
        body.credentials as Record<string, unknown>,
        previousCredentials(row as ProviderRow),
      );
      if (!sanitized.ok) return reply.code(400).send({ error: sanitized.error });
      patch.credentials = sanitized.credentials;
    }
    db.update(dnsProviders).set(patch).where(eq(dnsProviders.id, row.id)).run();
    const updated = db.select().from(dnsProviders).where(eq(dnsProviders.id, row.id)).all()[0];
    logEvent('info', `已更新 DNS Provider「${updated.name}」`);
    return { provider: toView(updated as ProviderRow) };
  });

  app.delete<{ Params: { id: string } }>('/dns-providers/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const row = id ? (db.select().from(dnsProviders).where(eq(dnsProviders.id, id)).all()[0] ?? null) : null;
    if (!row) return reply.code(404).send({ error: 'DNS Provider 不存在' });
    const using = db.select().from(certificates).where(eq(certificates.dnsProviderId, row.id)).all();
    if (using.length > 0) {
      return reply.code(409).send({ error: `有 ${using.length} 个证书正在使用该 Provider（如 ${using[0].primaryDomain}），请先处理这些证书` });
    }
    db.delete(dnsProviders).where(eq(dnsProviders.id, row.id)).run();
    logEvent('info', `已删除 DNS Provider「${row.name}」`);
    return { ok: true };
  });

  app.post('/dns-providers/test', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    let type: string;
    let credentials: Record<string, string>;

    if (body.providerId !== undefined) {
      const id = Number(body.providerId);
      const row = db.select().from(dnsProviders).where(eq(dnsProviders.id, id)).all()[0];
      if (!row) return reply.code(404).send({ error: 'DNS Provider 不存在' });
      type = row.type;
      credentials = previousCredentials(row as ProviderRow);
    } else {
      type = String(body.type ?? '');
      credentials = {};
      for (const [k, v] of Object.entries((body.credentials ?? {}) as Record<string, unknown>)) {
        if (v !== MASK) credentials[k] = String(v ?? '').trim();
      }
    }

    const result = await testDnsConnection(type, credentials);
    return reply.code(result.ok ? 200 : 400).send(result);
  });
}
