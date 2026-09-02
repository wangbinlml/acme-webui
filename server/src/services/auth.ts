import crypto from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';

/** 会话有效期：7 天 */
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
/** 登录失败锁定：同一 用户名+IP 连续失败 5 次锁 10 分钟 */
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 10 * 60 * 1000;

export interface AuthUser {
  id: number;
  username: string;
  /** admin | viewer */
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function countUsers(): number {
  return db.select({ id: users.id }).from(users).all().length;
}

export function getUserByUsername(username: string): (AuthUser & { passwordHash: string }) | null {
  const row = db.select().from(users).where(eq(users.username, username)).all()[0];
  return row ?? null;
}

export function getUserById(id: number): AuthUser | null {
  const row = db.select().from(users).where(eq(users.id, id)).all()[0];
  return row ? { id: row.id, username: row.username, role: row.role } : null;
}

export function listUsers(): Array<AuthUser & { createdAt: string }> {
  return db.select().from(users).all();
}

export function createUser(username: string, password: string, role: string): AuthUser {
  const now = new Date().toISOString();
  const res = db
    .insert(users)
    .values({ username, passwordHash: hashPassword(password), role, createdAt: now, updatedAt: now })
    .run();
  return { id: Number(res.lastInsertRowid), username, role };
}

export function countAdmins(): number {
  return db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).all().length;
}

export function updateUser(id: number, patch: { role?: string; password?: string }): void {
  const set: Record<string, string> = { updatedAt: new Date().toISOString() };
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.password !== undefined) set.passwordHash = hashPassword(patch.password);
  db.update(users).set(set).where(eq(users.id, id)).run();
}

export function deleteUser(id: number): void {
  db.delete(users).where(eq(users.id, id)).run();
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

export function createSession(userId: number): { token: string; maxAge: number } {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.insert(sessions)
    .values({
      token,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    })
    .run();
  // 顺手清理过期会话
  db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
  return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

export function getSessionUser(token: string): AuthUser | null {
  const row = db
    .select({ token: sessions.token, expiresAt: sessions.expiresAt, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .all()[0];
  if (!row) return null;
  if (row.expiresAt <= new Date().toISOString()) {
    db.delete(sessions).where(eq(sessions.token, token)).run();
    return null;
  }
  return { id: row.user.id, username: row.user.username, role: row.user.role };
}

export function destroySession(token: string): void {
  db.delete(sessions).where(eq(sessions.token, token)).run();
}

/** 删除某用户全部会话（改密/删除用户后强制下线） */
export function destroyUserSessions(userId: number): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

// ---------------------------------------------------------------------------
// 登录限速（内存即可：单实例部署，重启即清零可接受）
// ---------------------------------------------------------------------------

const failures = new Map<string, { count: number; lockedUntil: number }>();

function failKey(username: string, ip: string): string {
  return `${username}|${ip}`;
}

/** 登录前调用：处于锁定窗口则返回剩余毫秒数，否则 0 */
export function loginLockRemaining(username: string, ip: string): number {
  const rec = failures.get(failKey(username, ip));
  if (!rec) return 0;
  if (rec.lockedUntil > Date.now()) return rec.lockedUntil - Date.now();
  if (rec.lockedUntil !== 0 && rec.lockedUntil <= Date.now()) failures.delete(failKey(username, ip));
  return 0;
}

export function recordLoginFailure(username: string, ip: string): void {
  const key = failKey(username, ip);
  const rec = failures.get(key) ?? { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_LOGIN_FAILURES) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.count = 0;
  }
  failures.set(key, rec);
}

export function clearLoginFailures(username: string, ip: string): void {
  failures.delete(failKey(username, ip));
}

// ---------------------------------------------------------------------------
// Cookie 解析（不引入 @fastify/cookie，就一个 cookie）
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'acme_session';

export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) return part.slice(idx + 1).trim();
  }
  return null;
}
