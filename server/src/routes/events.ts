import type { FastifyInstance } from 'fastify';
import { recentLines, subscribe } from '../services/logger.js';

/**
 * SSE 实时日志流：连接时先回放最近的历史行，之后持续推送。
 * 事件格式：data: {"ts","level","source","message","certificateId"}
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const write = (line: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
    };
    for (const line of recentLines()) write(line);

    const unsubscribe = subscribe(write);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
