import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  clearLoginFailures,
  countUsers,
  createSession,
  createUser,
  destroySession,
  destroyUserSessions,
  getUserByUsername,
  loginLockRemaining,
  readSessionCookie,
  recordLoginFailure,
  SESSION_COOKIE,
  updateUser,
  verifyPassword,
} from '../services/auth.js';
import { logEvent } from '../services/logger.js';

function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function tokenOf(req: FastifyRequest): string | null {
  return readSessionCookie(req.headers.cookie);
}

function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return '密码长度需在 6-128 之间';
  }
  return null;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** 是否需要初始化管理员（无需登录） */
  app.get('/auth/status', () => ({ needsSetup: countUsers() === 0 }));

  /** 首次初始化：仅在没有任何用户时可用，创建 admin 并自动登录 */
  app.post('/auth/setup', async (req, reply) => {
    if (countUsers() > 0) return reply.code(409).send({ error: '管理员已初始化，请直接登录' });
    const { username, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || !/^\S{2,32}$/.test(username)) {
      return reply.code(400).send({ error: '用户名需为 2-32 个字符（不含空格）' });
    }
    const pwd = typeof password === 'string' ? password : '';
    const err = validatePassword(pwd);
    if (err) return reply.code(400).send({ error: err });
    const user = createUser(username, pwd, 'admin');
    const session = createSession(user.id);
    reply.header('set-cookie', sessionCookie(session.token, session.maxAge));
    logEvent('info', `初始管理员 ${username} 已创建`);
    return { user: { id: user.id, username: user.username, role: user.role } };
  });

  app.post('/auth/login', async (req, reply) => {
    const { username, password } = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof username === 'string' ? username : '';
    // 限速 key 为 用户名+对端 IP；经反代部署时 IP 均为 127.0.0.1，等效于按用户名限速
    const lockMs = loginLockRemaining(name, req.ip);
    if (lockMs > 0) {
      return reply.code(429).send({ error: `失败次数过多，请 ${Math.ceil(lockMs / 60000)} 分钟后再试` });
    }
    const row = getUserByUsername(name);
    if (!row || !verifyPassword(typeof password === 'string' ? password : '', row.passwordHash)) {
      recordLoginFailure(name, req.ip);
      return reply.code(401).send({ error: '用户名或密码错误' });
    }
    clearLoginFailures(name, req.ip);
    const session = createSession(row.id);
    reply.header('set-cookie', sessionCookie(session.token, session.maxAge));
    logEvent('info', `用户 ${name} 登录`);
    return { user: { id: row.id, username: row.username, role: row.role } };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = tokenOf(req);
    if (token) destroySession(token);
    reply.header('set-cookie', clearCookie());
    return { ok: true };
  });

  app.get('/auth/me', async (req) => ({ user: req.user }));

  /** 修改自己的密码；作废全部旧会话并重新签发当前会话 */
  app.put('/auth/password', async (req, reply) => {
    const { oldPassword, newPassword } = (req.body ?? {}) as Record<string, unknown>;
    const user = req.user!;
    const row = getUserByUsername(user.username);
    if (!row || !verifyPassword(String(oldPassword ?? ''), row.passwordHash)) {
      return reply.code(400).send({ error: '原密码不正确' });
    }
    const err = validatePassword(newPassword);
    if (err) return reply.code(400).send({ error: `新${err}` });
    updateUser(user.id, { password: String(newPassword) });
    destroyUserSessions(user.id);
    const session = createSession(user.id);
    reply.header('set-cookie', sessionCookie(session.token, session.maxAge));
    logEvent('info', `用户 ${user.username} 修改了密码`);
    return { ok: true };
  });
}
