import crypto from 'node:crypto';
import { getSetting } from './settings.js';
import { logEvent } from './logger.js';

export type NotifyChannel = 'wecom' | 'feishu';

export interface NotifyConfig {
  /** channel 与 webhook 都已配置时为 true */
  enabled: boolean;
  channel: NotifyChannel | null;
  webhook: string;
  feishuSecret: string;
}

export function getNotifyConfig(): NotifyConfig {
  const raw = getSetting('notifyChannel');
  const channel: NotifyChannel | null = raw === 'wecom' || raw === 'feishu' ? raw : null;
  const webhook = getSetting('notifyWebhook') ?? '';
  return {
    enabled: channel !== null && webhook.length > 0,
    channel,
    webhook,
    feishuSecret: getSetting('notifyFeishuSecret') ?? '',
  };
}

/** 飞书签名校验：以 `timestamp\nsecret` 为 key、空串为数据的 HMAC-SHA256，再 base64 */
function feishuSign(secret: string, timestamp: number): string {
  return crypto.createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
}

interface WebhookResponse {
  errcode?: number;
  errmsg?: string;
  code?: number;
  msg?: string;
  StatusCode?: number;
}

/**
 * 发送文本通知。永不抛异常：成功返回 null，失败返回可读的错误信息，
 * 让调用方（续期流程）不会被通知故障拖垮。
 */
export async function sendNotification(text: string): Promise<string | null> {
  const cfg = getNotifyConfig();
  if (!cfg.enabled || !cfg.channel) return '通知未配置';

  let body: Record<string, unknown>;
  if (cfg.channel === 'wecom') {
    body = { msgtype: 'text', text: { content: text } };
  } else {
    body = { msg_type: 'text', content: { text } };
    if (cfg.feishuSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      body.timestamp = String(timestamp);
      body.sign = feishuSign(cfg.feishuSecret, timestamp);
    }
  }

  try {
    const res = await fetch(cfg.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as WebhookResponse;
    // 企微返回 {errcode, errmsg}；飞书返回 {code, msg}（旧版 {StatusCode}）
    const code = data.errcode ?? data.code ?? data.StatusCode;
    if (!res.ok || (code !== undefined && code !== 0)) {
      const detail = data.errmsg ?? data.msg ?? '';
      return `HTTP ${res.status}${code !== undefined ? `，错误码 ${code}` : ''}${detail ? `：${detail}` : ''}`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** 发送通知并按结果记日志（通知失败只记 warn，不影响主流程） */
export async function notifyQuietly(text: string, certificateId?: number): Promise<void> {
  const err = await sendNotification(text);
  if (err) logEvent('warn', `推送通知失败：${err}`, certificateId);
  else logEvent('info', '已推送通知', certificateId);
}
