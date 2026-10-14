import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates, distributeTargets } from '../db/schema.js';
import { daysLeftOf, type Certificate } from './certificates.js';
import { type NotifyEvent, notifyQuietly } from './notifier.js';

/** 临期提醒窗口（天）：自动续期关闭的证书在此窗口内进入汇总 */
const SOON_DAYS = 30;
/** 每类问题最多列出的条数，超出折叠为「共 N 项」 */
const MAX_ITEMS = 10;

function firstLine(text: string | null, limit = 80): string {
  const line = (text ?? '').split('\n')[0].trim();
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

function itemOf(cert: Certificate, note?: string): string {
  const left = daysLeftOf(cert.expiresAt);
  const when = left === null ? '' : left < 0 ? `已过期 ${-left} 天` : `剩余 ${left} 天`;
  return `${cert.primaryDomain}${when ? `（${when}）` : ''}${note ? `：${note}` : ''}`;
}

function section(title: string, items: string[]): string | null {
  if (items.length === 0) return null;
  const head = items.slice(0, MAX_ITEMS).map((s) => `· ${s}`).join('\n');
  const tail = items.length > MAX_ITEMS ? `\n… 共 ${items.length} 项` : '';
  return `${title}：\n${head}${tail}`;
}

/**
 * 每日巡检汇总：随定时续期扫描（默认 03:00）发送到所有已配置的通知渠道。
 * 存在已过期 / 状态异常 / 临期且不会自动续期的证书时逐条列出；
 * 全部正常时发一行心跳（同时确认扫描与通知链路存活）。
 */
export async function sendDailyDigest(): Promise<void> {
  const certs = db.select().from(certificates).all();
  if (certs.length === 0) return;

  const expired: string[] = [];
  const errored: string[] = [];
  const stalled: string[] = [];
  for (const cert of certs) {
    const left = daysLeftOf(cert.expiresAt);
    if (cert.status === 'error') {
      errored.push(itemOf(cert, firstLine(cert.lastError) || '状态异常'));
    } else if (left !== null && left < 0) {
      expired.push(itemOf(cert));
    } else if (!cert.autoRenew && left !== null && left <= SOON_DAYS) {
      stalled.push(itemOf(cert, '自动续期已关闭，请手动续期或开启'));
    }
  }

  // 分发同步失败的目标
  const syncFailedTargets = db
    .select()
    .from(distributeTargets)
    .where(eq(distributeTargets.lastSyncStatus, 'error'))
    .all();
  const syncFailed: string[] = syncFailedTargets.map((t) => {
    const when = t.lastSyncAt ? `，${new Date(t.lastSyncAt).toLocaleString('zh-CN')} 同步失败` : '';
    return `${t.primaryDomain}（${t.ip}${when}）`;
  });

  const issues = expired.length + errored.length + stalled.length + syncFailed.length;
  const summary = `证书总数 ${certs.length}，正常 ${certs.length - expired.length - errored.length - stalled.length}，分发同步失败 ${syncFailed.length}，巡检时间 ${new Date().toLocaleString('zh-CN')}`;

  const ev: NotifyEvent =
    issues > 0
      ? {
          event: 'system.daily-digest',
          title: `⚠️ [Acme Manager] 每日巡检：${issues} 项需要关注`,
          message: [
            summary,
            section('❌ 已过期', expired),
            section('⚠️ 状态异常', errored),
            section(`⏰ ${SOON_DAYS} 天内到期且不会自动续期`, stalled),
            section('🔄 分发同步失败', syncFailed),
          ]
            .filter((s): s is string => s !== null)
            .join('\n\n'),
          ok: false,
        }
      : {
          event: 'system.daily-digest',
          title: '✅ [Acme Manager] 每日巡检正常',
          message: summary,
          ok: true,
        };
  await notifyQuietly(ev);
}
