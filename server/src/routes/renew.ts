import type { FastifyInstance } from 'fastify';
import { runRenewalScan } from '../services/cert-ops.js';
import { enqueue } from '../services/queue.js';

export async function renewRoutes(app: FastifyInstance): Promise<void> {
  /** 手动触发一次续期扫描（异步执行，结果见日志） */
  app.post('/renew/run', async () => {
    void enqueue(() => runRenewalScan('manual'));
    return { started: true, message: '已开始检查，执行过程请查看日志' };
  });
}
