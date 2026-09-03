import crypto from 'node:crypto';
import { config } from '../config.js';
import { getSetting } from './settings.js';
import { logEvent } from './logger.js';
import { sendMail, type SmtpConfig } from './smtp.js';

export type NotifyChannelName = 'robot' | 'webhook' | 'smtp';

export type NotifyEventName =
  | 'test'
  | 'cert.issue.success'
  | 'cert.issue.failed'
  | 'cert.renew.success'
  | 'cert.renew.failed';

export interface NotifyEvent {
  event: NotifyEventName;
  /** 标题：邮件主题 / 机器人首行 */
  title: string;
  /** 多行正文 */
  message: string;
  ok?: boolean;
  domain?: string;
  domains?: string[];
  ca?: string;
  expiresAt?: string;
  error?: string;
}

export interface RobotConfig {
  channel: 'wecom' | 'feishu';
  webhook: string;
  feishuSecret: string;
}

export interface WebhookConfig {
  url: string;
}

export interface SmtpNotifyConfig extends SmtpConfig {
  /** 原始收件人串（逗号分隔），用于设置页回显 */
  rawTo: string;
}

export interface NotifyConfig {
  robot: RobotConfig | null;
  webhook: WebhookConfig | null;
  smtp: SmtpNotifyConfig | null;
}

export interface ChannelResult {
  channel: NotifyChannelName;
  ok: boolean;
  error?: string;
}

function parseRecipients(raw: string): string[] {
  return [...new Set(raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean))];
}

export function getNotifyConfig(): NotifyConfig {
  const rawChannel = getSetting('notifyChannel');
  const channel = rawChannel === 'wecom' || rawChannel === 'feishu' ? rawChannel : null;
  const robotWebhook = getSetting('notifyWebhook') ?? '';
  const robot: RobotConfig | null =
    channel && robotWebhook ? { channel, webhook: robotWebhook, feishuSecret: getSetting('notifyFeishuSecret') ?? '' } : null;

  const webhookUrl = getSetting('notifyGenericWebhook') ?? '';
  const webhook: WebhookConfig | null = webhookUrl ? { url: webhookUrl } : null;

  const host = getSetting('smtpHost') ?? '';
  const to = getSetting('smtpTo') ?? '';
  const smtp: SmtpNotifyConfig | null =
    host && to
      ? {
          host,
          port: Number(getSetting('smtpPort') ?? 465) || 465,
          user: getSetting('smtpUser') ?? '',
          pass: getSetting('smtpPass') ?? '',
          from: getSetting('smtpFrom') || getSetting('smtpUser') || `acme-manager@${host}`,
          to: parseRecipients(to),
          rawTo: to,
        }
      : null;

  return { robot, webhook, smtp };
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

async function sendRobot(cfg: RobotConfig, ev: NotifyEvent): Promise<ChannelResult> {
  const text = `${ev.title}\n${ev.message}`;
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
      return {
        channel: 'robot',
        ok: false,
        error: `HTTP ${res.status}${code !== undefined ? `，错误码 ${code}` : ''}${detail ? `：${detail}` : ''}`,
      };
    }
    return { channel: 'robot', ok: true };
  } catch (err) {
    return { channel: 'robot', ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 通用 Webhook：POST 一段 JSON，HTTP 2xx 视为成功，适合对接 ntfy / Bark / 自建脚本等 */
async function sendGenericWebhook(cfg: WebhookConfig, ev: NotifyEvent): Promise<ChannelResult> {
  const payload = {
    event: ev.event,
    title: ev.title,
    message: ev.message,
    ok: ev.ok ?? !ev.event.endsWith('.failed'),
    domain: ev.domain,
    domains: ev.domains,
    ca: ev.ca,
    expiresAt: ev.expiresAt,
    error: ev.error,
    version: config.version,
    timestamp: new Date().toISOString(),
  };
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { channel: 'webhook', ok: false, error: `HTTP ${res.status}` };
    return { channel: 'webhook', ok: true };
  } catch (err) {
    return { channel: 'webhook', ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendSmtp(cfg: SmtpNotifyConfig, ev: NotifyEvent): Promise<ChannelResult> {
  try {
    await sendMail(cfg, ev.title, ev.message);
    return { channel: 'smtp', ok: true };
  } catch (err) {
    return { channel: 'smtp', ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 向所有已启用的渠道（机器人 / Webhook / 邮件）发送通知。
 * 传 only 可只发某一渠道（测试按钮用）。永不抛异常，逐渠道返回结果。
 */
export async function sendNotification(ev: NotifyEvent, only?: NotifyChannelName): Promise<ChannelResult[]> {
  const cfg = getNotifyConfig();
  const jobs: Array<Promise<ChannelResult>> = [];
  if (cfg.robot && (!only || only === 'robot')) jobs.push(sendRobot(cfg.robot, ev));
  if (cfg.webhook && (!only || only === 'webhook')) jobs.push(sendGenericWebhook(cfg.webhook, ev));
  if (cfg.smtp && (!only || only === 'smtp')) jobs.push(sendSmtp(cfg.smtp, ev));
  return Promise.all(jobs);
}

/** 发送通知并按结果记日志（通知失败只记 warn，不影响主流程） */
export async function notifyQuietly(ev: NotifyEvent, certificateId?: number): Promise<void> {
  const results = await sendNotification(ev);
  if (results.length === 0) return; // 未配置任何渠道
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    logEvent('info', `已推送通知（${results.map((r) => r.channel).join('、')}）`, certificateId);
    return;
  }
  for (const f of failed) {
    logEvent('warn', `推送通知失败（${f.channel}）：${f.error ?? '未知错误'}`, certificateId);
  }
}
