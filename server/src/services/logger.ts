import fs from 'node:fs';
import { lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logs, sessions } from '../db/schema.js';
import { config } from '../config.js';
import { getSetting } from './settings.js';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LiveLine {
  ts: string;
  level: LogLevel;
  source: 'system' | 'acme';
  message: string;
  certificateId?: number | null;
}

const MAX_BUFFER = 500;
const buffer: LiveLine[] = [];
type Listener = (line: LiveLine) => void;
const listeners = new Set<Listener>();

export function pushLive(line: Omit<LiveLine, 'ts'> & { ts?: string }): LiveLine {
  const full: LiveLine = { ts: line.ts ?? new Date().toISOString(), ...line };
  buffer.push(full);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  for (const fn of listeners) {
    try {
      fn(full);
    } catch {
      // 单个订阅者异常不影响其他订阅者
    }
  }
  return full;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recentLines(): LiveLine[] {
  return [...buffer];
}

/** 记录一条业务事件：写入数据库 + 推送到实时日志流 */
export function logEvent(level: LogLevel, message: string, certificateId?: number | null): void {
  pushLive({ level, source: 'system', message, certificateId: certificateId ?? null });
  try {
    db.insert(logs)
      .values({ level, message, certificateId: certificateId ?? null, createdAt: new Date().toISOString() })
      .run();
  } catch (err) {
    console.error('failed to persist log:', err);
  }
}

export interface RetentionResult {
  logsDeleted: number;
  sessionsPurged: number;
  acmeLogRotated: boolean;
}

/** 日志保留天数：设置里可改，0 表示永久保留，默认 30 */
export function getLogRetentionDays(): number {
  const raw = getSetting('logRetentionDays');
  if (raw === null || raw === '') return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}

/** acme.sh 运行日志超过 5MB 时轮转为 .log.1（只保留一代），避免无界增长 */
export function rotateAcmeLog(): boolean {
  try {
    if (fs.statSync(config.acmeLogFile).size < 5 * 1024 * 1024) return false;
    fs.rmSync(`${config.acmeLogFile}.1`, { force: true });
    fs.renameSync(config.acmeLogFile, `${config.acmeLogFile}.1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理过期数据：N 天前的日志 + 已过期登录会话 + 超限的 acme.sh 运行日志。
 * 每日 cron 与「日志」页手动清理共用；删除完成后记一条汇总（自身不受影响）。
 */
export function runLogRetention(): RetentionResult {
  const days = getLogRetentionDays();
  let logsDeleted = 0;
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    logsDeleted = db.delete(logs).where(lt(logs.createdAt, cutoff)).run().changes;
  }
  const sessionsPurged = db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date().toISOString()))
    .run().changes;
  const acmeLogRotated = rotateAcmeLog();
  if (logsDeleted > 0 || sessionsPurged > 0 || acmeLogRotated) {
    logEvent(
      'info',
      `日志清理：删除 ${logsDeleted} 条日志、${sessionsPurged} 条过期会话${acmeLogRotated ? '，acme.sh 运行日志已轮转' : ''}`,
    );
  }
  return { logsDeleted, sessionsPurged, acmeLogRotated };
}
