import type { FastifyInstance } from 'fastify';
import {
  countAdmins,
  createUser,
  deleteUser,
  destroyUserSessions,
  getUserById,
  getUserByUsername,
  listUsers,
  updateUser,
} from '../services/auth.js';
import { logEvent } from '../services/logger.js';
import { logAudit } from '../services/audit.js';

/** 用户管理（仅 admin，认证钩子里已做角色检查） */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', async () => ({
    users: listUsers().map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })),
  }));

  app.post('/users', async (req, reply) => {
    const { username, password, role } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || !/^\S{2,32}$/.test(username)) {
      return reply.code(400).send({ error: '用户名需为 2-32 个字符（不含空格）' });
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return reply.code(400).send({ error: '密码长度需在 6-128 之间' });
    }
    if (role !== 'admin' && role !== 'viewer') {
      return reply.code(400).send({ error: '角色不合法' });
    }
    if (getUserByUsername(username)) {
      return reply.code(409).send({ error: '用户名已存在' });
    }
    const user = createUser(username, password, role);
    logEvent('info', `用户 ${username} 已创建（${role}，操作者 ${req.user!.username}）`);
    logAudit(req, 'user.create', `创建用户 ${username}（角色 ${role}）`);
    return { user: { id: user.id, username: user.username, role: user.role } };
  });

  app.put('/users/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const target = getUserById(id);
    if (!target) return reply.code(404).send({ error: '用户不存在' });
    const { role, password } = (req.body ?? {}) as Record<string, unknown>;

    if (role !== undefined) {
      if (role !== 'admin' && role !== 'viewer') {
        return reply.code(400).send({ error: '角色不合法' });
      }
      // 不允许把系统里最后一个管理员降级
      if (target.role === 'admin' && role !== 'admin' && countAdmins() <= 1) {
        return reply.code(400).send({ error: '系统至少需要保留一个管理员' });
      }
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 6 || password.length > 128)) {
      return reply.code(400).send({ error: '密码长度需在 6-128 之间' });
    }

    updateUser(id, {
      role: role === undefined ? undefined : String(role),
      password: password === undefined ? undefined : String(password),
    });
    // 改密后强制该用户全部会话下线；改角色也下线，让新权限立即生效
    destroyUserSessions(id);
    logEvent(
      'info',
      `用户 ${target.username} 已更新（${role !== undefined ? `角色→${role} ` : ''}${password !== undefined ? '密码已重置' : ''}，操作者 ${req.user!.username}）`,
    );
    logAudit(
      req,
      'user.update',
      `更新用户 ${target.username}（${role !== undefined ? `角色→${role} ` : ''}${password !== undefined ? '密码已重置' : ''}）`,
    );
    return { ok: true };
  });

  app.delete('/users/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (id === req.user!.id) return reply.code(400).send({ error: '不能删除当前登录的账号' });
    const target = getUserById(id);
    if (!target) return reply.code(404).send({ error: '用户不存在' });
    if (target.role === 'admin' && countAdmins() <= 1) {
      return reply.code(400).send({ error: '系统至少需要保留一个管理员' });
    }
    deleteUser(id);
    logEvent('info', `用户 ${target.username} 已删除（操作者 ${req.user!.username}）`);
    logAudit(req, 'user.delete', `删除用户 ${target.username}`);
    return { ok: true };
  });
}
