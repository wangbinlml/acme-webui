import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

interface AuditActor {
  user?: { username?: string } | null;
  ip?: string;
}

/**
 * 记录一条审计日志（谁在什么时间对什么做了什么）。
 * 与业务日志（logs 表）分开存储；写入失败只打 console，不影响主流程。
 */
export function logAudit(actor: AuditActor, action: string, detail?: string): void {
  try {
    db.insert(auditLogs)
      .values({
        username: actor.user?.username ?? '-',
        action,
        detail: detail ?? null,
        ip: actor.ip ?? null,
        createdAt: new Date().toISOString(),
      })
      .run();
  } catch (err) {
    console.error('failed to write audit log:', err);
  }
}
