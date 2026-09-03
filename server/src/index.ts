import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { acmeAvailable, config, ensureDirs } from './config.js';
import { db, runMigrations, appliedRestore } from './db/index.js';
import { certificates } from './db/schema.js';
import { logEvent, runLogRetention } from './services/logger.js';
import { enqueue } from './services/queue.js';
import { runRenewalScan } from './services/cert-ops.js';
import { getSessionUser, readSessionCookie } from './services/auth.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { certificateRoutes } from './routes/certificates.js';
import { dnsProviderRoutes } from './routes/dns-providers.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { logRoutes } from './routes/logs.js';
import { settingsRoutes } from './routes/settings.js';
import { eventRoutes } from './routes/events.js';
import { renewRoutes } from './routes/renew.js';

let staticRegistered = false;

async function main(): Promise<void> {
  ensureDirs();
  runMigrations();
  if (appliedRestore) {
    logEvent(
      'info',
      `已从${appliedRestore.scope === 'full' ? '完整' : '仅配置'}备份恢复数据；恢复前的自动留底为 data/pre-restore-safety.tar.gz`,
    );
  }

  // 服务重启会把进行中的任务标记为失败，避免永远卡在“签发中”
  db.update(certificates)
    .set({ status: 'error', lastError: '服务重启导致任务中断，请重试', updatedAt: new Date().toISOString() })
    .where(eq(certificates.status, 'issuing'))
    .run();

  const app = Fastify({ logger: false });

  app.get('/api/health', () => ({
    ok: true,
    version: config.version,
    acmeAvailable: acmeAvailable(),
  }));

  // 认证与角色控制：除下列公开端点外，所有 /api 请求都需要登录会话
  const PUBLIC_API = new Set(['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup']);
  app.addHook('onRequest', async (req, reply) => {
    const url = (req.raw.url ?? '').split('?')[0];
    if (!url.startsWith('/api/') || PUBLIC_API.has(url)) return;

    const token = readSessionCookie(req.headers.cookie);
    const user = token ? getSessionUser(token) : null;
    if (!user) return reply.code(401).send({ error: '未登录或会话已过期' });
    req.user = user;

    // /api/auth/* 只要求已登录（改自己密码/登出不分角色）；
    // 其余接口：viewer 只读；用户管理仅 admin
    if (url.startsWith('/api/auth/')) return;
    if (user.role !== 'admin') {
      if (url.startsWith('/api/users')) {
        return reply.code(403).send({ error: '需要管理员权限' });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return reply.code(403).send({ error: '当前账号为只读角色（viewer），仅管理员可执行此操作' });
      }
    }
  });

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(userRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.register(certificateRoutes, { prefix: '/api' });
  await app.register(dnsProviderRoutes, { prefix: '/api' });
  await app.register(logRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.register(eventRoutes, { prefix: '/api' });
  await app.register(renewRoutes, { prefix: '/api' });

  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    staticRegistered = true;
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/') || !staticRegistered || req.method !== 'GET') {
      return reply.code(404).send({ error: 'Not Found' });
    }
    // SPA 前端路由回退
    return reply.sendFile('index.html');
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    console.error(`[error] ${req.method} ${req.url}:`, err);
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send({ error: err.message || 'Internal Server Error' });
  });

  cron.schedule(config.renewCron, () => {
    // 顺带做日志/会话清理（秒级完成，不进任务队列）
    runLogRetention();
    void enqueue(() => runRenewalScan('cron'));
  });

  await app.listen({ port: config.port, host: config.host });
  logEvent(
    'info',
    `Acme Manager v${config.version} 已启动 http://${config.host}:${config.port}，续期计划：${config.renewCron}（服务器时区）`,
  );
  if (!acmeAvailable()) {
    logEvent('warn', `未找到 acme.sh（${config.acmeBin}），签发/续期将失败。Docker 部署会在容器启动时自动安装。`);
  }
  console.log(`listening on http://${config.host}:${config.port}, web dist: ${staticRegistered ? path.basename(config.webDist) : 'not found (API only)'}`);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => process.exit(0));
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
