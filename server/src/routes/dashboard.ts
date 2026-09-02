import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { certificates } from '../db/schema.js';
import { toView } from '../services/certificates.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', async () => {
    const views = db.select().from(certificates).all().map(toView);
    const stats = {
      total: views.length,
      ok: views.filter((c) => c.displayStatus === 'ok').length,
      expiring: views.filter((c) => c.displayStatus === 'expiring').length,
      expired: views.filter((c) => c.displayStatus === 'expired').length,
      error: views.filter((c) => c.displayStatus === 'error').length,
      issuing: views.filter((c) => c.displayStatus === 'issuing').length,
    };
    const recent = [...views]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5);
    return { stats, recent };
  });
}
