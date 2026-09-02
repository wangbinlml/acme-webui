import { db } from '../db/index.js';
import { logs } from '../db/schema.js';

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
