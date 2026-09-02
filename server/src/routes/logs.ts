import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates, logs } from '../db/schema.js';

export async function logRoutes(app: FastifyInstance): Promise<void> {
  app.get('/logs', async (req) => {
    const query = req.query as { limit?: string; level?: string; certificateId?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 200) || 200, 1), 1000);
    const conditions: SQL[] = [];
    if (query.level && ['info', 'warn', 'error'].includes(query.level)) {
      conditions.push(eq(logs.level, query.level));
    }
    const certId = Number(query.certificateId);
    if (Number.isInteger(certId) && certId > 0) {
      conditions.push(eq(logs.certificateId, certId));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = where
      ? db.select().from(logs).where(where).orderBy(desc(logs.id)).limit(limit).all()
      : db.select().from(logs).orderBy(desc(logs.id)).limit(limit).all();

    const domainById = new Map(
      db.select().from(certificates).all().map((c) => [c.id, c.primaryDomain]),
    );
    return {
      logs: rows.map((r) => ({
        ...r,
        domain: r.certificateId ? (domainById.get(r.certificateId) ?? null) : null,
      })),
    };
  });
}
