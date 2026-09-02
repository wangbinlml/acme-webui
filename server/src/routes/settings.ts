import type { FastifyInstance } from 'fastify';
import { acmeAvailable, config } from '../config.js';
import { getAccountEmail, getSetting, setSetting } from '../services/settings.js';
import { logEvent } from '../services/logger.js';
import { getNotifyConfig, sendNotification } from '../services/notifier.js';

/** 与 DNS 凭据一致的脱敏哨兵：PUT 时值等于它则保留原值 */
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

function notifyView(): {
  channel: string;
  webhook: string;
  feishuSecret: string;
} {
  const cfg = getNotifyConfig();
  return {
    channel: cfg.channel ?? '',
    webhook: cfg.webhook ? maskWebhook(cfg.webhook) : '',
    feishuSecret: cfg.feishuSecret ? MASK : '',
  };
}

async function saveNotify(body: Record<string, unknown>): Promise<string | null> {
  const channel = String(body.channel ?? '');
  if (channel !== '' && channel !== 'wecom' && channel !== 'feishu') {
    return '通知渠道不合法';
  }
  let webhook = String(body.webhook ?? '').trim();
  // MASK 哨兵或脱敏显示值原样传回（含 ****）都视为「未修改」，保留原值
  if (webhook === MASK || webhook.includes('****')) webhook = getSetting('notifyWebhook') ?? '';
  if (webhook && !/^https?:\/\//.test(webhook)) {
    return 'Webhook 地址必须以 http(s):// 开头';
  }
  if (channel && !webhook) {
    return '选择通知渠道后必须填写 Webhook 地址';
  }
  let secret = String(body.feishuSecret ?? '').trim();
  if (secret === MASK) secret = getSetting('notifyFeishuSecret') ?? '';

  setSetting('notifyChannel', channel);
  setSetting('notifyWebhook', channel ? webhook : '');
  setSetting('notifyFeishuSecret', channel === 'feishu' ? secret : '');
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
      const notifyBody = body.notify as Record<string, unknown>;
      const err = await saveNotify(notifyBody);
      if (err) return reply.code(400).send({ error: err });
      const cfg = getNotifyConfig();
      logEvent(
        cfg.enabled ? 'info' : 'warn',
        cfg.enabled ? `通知推送已启用（${cfg.channel === 'wecom' ? '企业微信' : '飞书'}）` : '通知推送已停用',
      );
    }
    return { ok: true };
  });

  /** 发送一条测试消息，验证通知配置是否可用（使用已保存的配置） */
  app.post('/settings/notify/test', async (_req, reply) => {
    const cfg = getNotifyConfig();
    if (!cfg.enabled) {
      return reply.code(400).send({ error: '请先保存可用的通知配置（渠道 + Webhook）' });
    }
    const who = cfg.channel === 'wecom' ? '企业微信' : '飞书';
    const err = await sendNotification(`🤖 [Acme Manager] ${who}通知测试成功\n收到此消息说明推送配置正确`);
    if (err) {
      logEvent('warn', `通知测试失败（${who}）：${err}`);
      return reply.code(502).send({ error: `推送失败：${err}` });
    }
    logEvent('info', `通知测试成功（${who}）`);
    return { ok: true, message: `测试消息已发送到${who}群` };
  });
}
