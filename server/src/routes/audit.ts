import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  /** 审计日志查询（仅管理员） */
  app.get('/audit', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: '需要管理员权限' });
    const query = (req.query ?? {}) as { limit?: string; username?: string; action?: string };
    const limitRaw = Number(query.limit ?? 200);
    const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 200, 1), 1000);

    const conditions = [];
    if (query.username?.trim()) conditions.push(eq(auditLogs.username, query.username.trim()));
    if (query.action?.trim()) conditions.push(eq(auditLogs.action, query.action.trim()));

    const rows =
      conditions.length > 0
        ? db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.id)).limit(limit).all()
        : db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(limit).all();

    return { logs: rows };
  });

  /** 已出现过的操作类型（供筛选下拉） */
  app.get('/audit/actions', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: '需要管理员权限' });
    const rows = db.select({ action: auditLogs.action }).from(auditLogs).groupBy(auditLogs.action).all();
    return { actions: rows.map((r) => r.action) };
  });
}
