import type { FastifyInstance } from 'fastify';
import { acmeAvailable, config } from '../config.js';
import { getAccountEmail, getSetting, setSetting } from '../services/settings.js';
import { logEvent } from '../services/logger.js';
import { getNotifyConfig, sendNotification, type NotifyEvent } from '../services/notifier.js';

/** 与 DNS 凭据一致的脱敏哨兵：保存时值等于它则保留原值 */
const MASK = '••••••••';

function maskWebhook(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    // 企微 key 在 query，飞书 token 在 path 末段，都只留末 4 位
    for (const [k, v] of u.searchParams.entries()) {
      if (v.length > 4) u.searchParams.set(k, `****${v.slice(-4)}`);
    }
    const segs = u.pathname.split('/');
    const last = segs[segs.length - 1];
    if (last.length > 8) segs[segs.length - 1] = `****${last.slice(-4)}`;
    u.pathname = segs.join('/');
    return u.toString();
  } catch {
    return url;
  }
}

function notifyView() {
  const channel = getSetting('notifyChannel') ?? '';
  const robotWebhook = getSetting('notifyWebhook') ?? '';
  const feishuSecret = getSetting('notifyFeishuSecret') ?? '';
  const genericUrl = getSetting('notifyGenericWebhook') ?? '';
  const smtpPass = getSetting('smtpPass') ?? '';
  const port = Number(getSetting('smtpPort') ?? 465) || 465;
  return {
    robot: {
      channel: channel === 'wecom' || channel === 'feishu' ? channel : '',
      webhook: robotWebhook ? maskWebhook(robotWebhook) : '',
      feishuSecret: feishuSecret ? MASK : '',
    },
    webhook: { url: genericUrl ? maskWebhook(genericUrl) : '' },
    smtp: {
      host: getSetting('smtpHost') ?? '',
      port,
      user: getSetting('smtpUser') ?? '',
      from: getSetting('smtpFrom') ?? '',
      to: getSetting('smtpTo') ?? '',
      password: smtpPass ? MASK : '',
    },
  };
}

/** 分段保存通知配置：body 里出现哪段（robot / webhook / smtp）就校验并保存哪段 */
async function saveNotify(body: Record<string, unknown>): Promise<string | null> {
  if (body.robot !== undefined) {
    const r = (body.robot ?? {}) as Record<string, unknown>;
    const channel = String(r.channel ?? '');
    if (channel !== '' && channel !== 'wecom' && channel !== 'feishu') {
      return '通知渠道不合法';
    }
    let webhook = String(r.webhook ?? '').trim();
    // MASK 哨兵或脱敏显示值原样传回（含 ****）都视为「未修改」，保留原值
    if (webhook === MASK || webhook.includes('****')) webhook = getSetting('notifyWebhook') ?? '';
    if (webhook && !/^https?:\/\//.test(webhook)) {
      return 'Webhook 地址必须以 http(s):// 开头';
    }
    if (channel && !webhook) {
      return '选择机器人渠道后必须填写 Webhook 地址';
    }
    let secret = String(r.feishuSecret ?? '').trim();
    if (secret === MASK) secret = getSetting('notifyFeishuSecret') ?? '';
    setSetting('notifyChannel', channel);
    setSetting('notifyWebhook', channel ? webhook : '');
    setSetting('notifyFeishuSecret', channel === 'feishu' ? secret : '');
  }

  if (body.webhook !== undefined) {
    const w = (body.webhook ?? {}) as Record<string, unknown>;
    let url = String(w.url ?? '').trim();
    if (url === MASK || url.includes('****')) url = getSetting('notifyGenericWebhook') ?? '';
    if (url && !/^https?:\/\//.test(url)) {
      return 'Webhook 地址必须以 http(s):// 开头';
    }
    setSetting('notifyGenericWebhook', url);
  }

  if (body.smtp !== undefined) {
    const s = (body.smtp ?? {}) as Record<string, unknown>;
    const host = String(s.host ?? '').trim();
    const port = Math.min(Math.max(Number(s.port ?? 465) || 465, 1), 65535);
    const user = String(s.user ?? '').trim();
    let pass = String(s.password ?? '').trim();
    if (pass === MASK) pass = getSetting('smtpPass') ?? '';
    const from = String(s.from ?? '').trim();
    const to = String(s.to ?? '').trim();
    if (host) {
      if (!to) return '配置 SMTP 后必须填写收件邮箱';
      const bad = to.split(/[,;\s]+/).filter((t) => t && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));
      if (bad.length > 0) return `收件邮箱格式不正确：${bad.join('、')}`;
      if (from && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) return '发件人地址格式不正确';
    }
    setSetting('smtpHost', host);
    setSetting('smtpPort', String(port));
    setSetting('smtpUser', host ? user : '');
    setSetting('smtpPass', host ? pass : '');
    setSetting('smtpFrom', host ? from : '');
    setSetting('smtpTo', host ? to : '');
  }

  return null;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', async () => ({
    accountEmail: getAccountEmail() ?? '',
    renewCron: config.renewCron,
    acmeBin: config.acmeBin,
    acmeAvailable: acmeAvailable(),
    version: config.version,
    notify: notifyView(),
  }));

  app.put('/settings', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = String(body.accountEmail ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: '邮箱格式不正确' });
    }
    setSetting('accountEmail', email);
    logEvent(email ? 'info' : 'warn', email ? `账户邮箱已设置为 ${email}` : '账户邮箱已清空');

    if (body.notify !== undefined) {
      const err = await saveNotify(body.notify as Record<string, unknown>);
      if (err) return reply.code(400).send({ error: err });
      const cfg = getNotifyConfig();
      const names = [cfg.robot ? '机器人' : '', cfg.webhook ? 'Webhook' : '', cfg.smtp ? '邮件' : ''].filter(Boolean);
      logEvent(
        names.length > 0 ? 'info' : 'warn',
        names.length > 0 ? `通知推送已启用（${names.join('、')}）` : '通知推送已全部停用',
      );
    }
    return { ok: true };
  });

  /** 发送测试消息验证通知配置；body.channel 可指定只测某一渠道（robot/webhook/smtp） */
  app.post('/settings/notify/test', async (req, reply) => {
    const body = (req.body ?? {}) as { channel?: string };
    const only =
      body.channel === 'robot' || body.channel === 'webhook' || body.channel === 'smtp' ? body.channel : undefined;
    const cfg = getNotifyConfig();
    if (only && !cfg[only]) {
      return reply.code(400).send({ error: '该渠道尚未配置，请先保存' });
    }
    if (!only && !cfg.robot && !cfg.webhook && !cfg.smtp) {
      return reply.code(400).send({ error: '请先保存至少一个通知渠道' });
    }
    const ev: NotifyEvent = {
      event: 'test',
      title: '🤖 [Acme Manager] 通知测试',
      message: ['收到此消息说明该渠道推送配置正确', `时间：${new Date().toLocaleString('zh-CN')}`].join('\n'),
      ok: true,
    };
    const results = await sendNotification(ev, only);
    for (const r of results) {
      logEvent(r.ok ? 'info' : 'warn', `通知测试（${r.channel}）${r.ok ? '成功' : `失败：${r.error ?? '未知错误'}`}`);
    }
    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      results,
      message:
        failed.length === 0
          ? '测试消息已发送，请查收'
          : `测试失败：${failed.map((f) => `${f.channel}：${f.error ?? '未知错误'}`).join('；')}`,
    };
  });
}
