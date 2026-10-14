import fs from 'node:fs';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates, distributeTargets } from '../db/schema.js';
import { filesFor } from '../services/certificates.js';
import { getDistributeToken, setSetting } from '../services/settings.js';
import { logEvent } from '../services/logger.js';
import { type NotifyEvent, notifyQuietly } from '../services/notifier.js';

/** 同一主域名有多张证书时取最新一张，有文件路径的优先 */
function certByDomain(domain: string) {
  const rows = db
    .select()
    .from(certificates)
    .where(eq(certificates.primaryDomain, domain))
    .orderBy(desc(certificates.id))
    .all();
  return rows.find((r) => r.certPath && r.keyPath) ?? rows[0] ?? null;
}

/** 按 (域名, IP) upsert 分发目标记录。action=install 更新配置；action=sync 更新同步状态 */
function upsertDistributeTarget(
  domain: string,
  ip: string,
  action: 'install' | 'sync',
  extra?: { reloadMode?: string; container?: string; certDir?: string; status?: string; message?: string },
): void {
  const now = new Date().toISOString();
  const ipLabel = ip || '未知';
  try {
    if (action === 'install') {
      db.insert(distributeTargets)
        .values({
          primaryDomain: domain,
          ip: ipLabel,
          reloadMode: extra?.reloadMode ?? null,
          container: extra?.container || null,
          certDir: extra?.certDir ?? null,
          firstSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [distributeTargets.primaryDomain, distributeTargets.ip],
          set: {
            reloadMode: extra?.reloadMode ?? null,
            container: extra?.container || null,
            certDir: extra?.certDir ?? null,
            updatedAt: now,
          },
        })
        .run();
    } else {
      db.insert(distributeTargets)
        .values({
          primaryDomain: domain,
          ip: ipLabel,
          firstSeenAt: now,
          lastSyncAt: now,
          lastSyncStatus: extra?.status ?? 'success',
          lastSyncMessage: extra?.message ?? null,
          syncCount: 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [distributeTargets.primaryDomain, distributeTargets.ip],
          set: {
            lastSyncAt: now,
            lastSyncStatus: extra?.status ?? 'success',
            lastSyncMessage: extra?.message ?? null,
            syncCount: sql`${distributeTargets.syncCount} + 1`,
            updatedAt: now,
          },
        })
        .run();
    }
  } catch (err) {
    console.error('failed to upsert distribute target:', err);
  }
}

/** 目标机器上的同步脚本：读 /etc/acme-distribute/*.conf，逐域名拉取，内容有变化才 reload。
 *  由安装脚本写入，内容固定（<<'PULL_EOF' 不做变量展开）。 */
function pullScriptBody(): string {
  return `#!/usr/bin/env bash
# Acme Manager 证书分发同步：读取 /etc/acme-distribute/*.conf，逐域名拉取，内容有变化才 reload
set -uo pipefail

VERBOSE=''
[ "\${1:-}" = '-v' ] && VERBOSE=1

log() { echo "[\$(date '+%F %T')] \$*"; }

# cron 的 PATH 通常不含 sbin 目录，nginx 不在 PATH 时回退到 /usr/sbin/nginx
NGINX_BIN="\$(command -v nginx 2>/dev/null || echo /usr/sbin/nginx)"

# 向管理机上报同步结果（best-effort，失败不影响同步）
report_sync() {
  curl -fsS -X POST -H "Authorization: Bearer \$TOKEN" \\
    "\$MANAGER/api/distribute/report?domain=\$DOMAIN&action=sync&status=\$1" || true
}

for conf in /etc/acme-distribute/*.conf; do
  [ -f "\$conf" ] || continue
  # shellcheck disable=SC1090
  . "\$conf"

  tmp=\$(mktemp -d) || continue
  if ! curl -fsS -o "\$tmp/fullchain.pem" -H "Authorization: Bearer \$TOKEN" \\
      "\$MANAGER/api/distribute/file?domain=\$DOMAIN&type=fullchain"; then
    log "\${DOMAIN}：下载 fullchain 失败（管理机不可达 / Token 已失效 / 证书未签发），跳过"
    report_sync error
    rm -rf "\$tmp"; continue
  fi
  if ! curl -fsS -o "\$tmp/privkey.pem" -H "Authorization: Bearer \$TOKEN" \\
      "\$MANAGER/api/distribute/file?domain=\$DOMAIN&type=key"; then
    log "\${DOMAIN}：下载 privkey 失败，跳过"
    report_sync error
    rm -rf "\$tmp"; continue
  fi

  # 内容防线：返回 200 但不是 PEM（如反代重定向页/默认页）时拒绝安装，保住机器上的现有证书
  if ! head -c 64 "\$tmp/fullchain.pem" | grep -q 'BEGIN CERTIFICATE'; then
    log "\${DOMAIN}：下载到的 fullchain 不是证书内容（MANAGER 地址 \$MANAGER 可能被重定向或返回了网页），跳过"
    report_sync error
    rm -rf "\$tmp"; continue
  fi
  if ! head -c 64 "\$tmp/privkey.pem" | grep -q 'PRIVATE KEY'; then
    log "\${DOMAIN}：下载到的 privkey 不是私钥内容，跳过"
    report_sync error
    rm -rf "\$tmp"; continue
  fi

  if [ -f "\$CERT_DIR/fullchain.pem" ] && [ -f "\$CERT_DIR/privkey.pem" ] \\
     && cmp -s "\$tmp/fullchain.pem" "\$CERT_DIR/fullchain.pem" \\
     && cmp -s "\$tmp/privkey.pem" "\$CERT_DIR/privkey.pem"; then
    [ -n "\$VERBOSE" ] && log "\${DOMAIN}：证书无变化"
    report_sync no_change
    rm -rf "\$tmp"; continue
  fi

  mkdir -p "\$CERT_DIR"
  mv "\$tmp/fullchain.pem" "\$CERT_DIR/fullchain.pem"
  mv "\$tmp/privkey.pem" "\$CERT_DIR/privkey.pem"
  chmod 644 "\$CERT_DIR/fullchain.pem"
  chmod 600 "\$CERT_DIR/privkey.pem"
  rm -rf "\$tmp"

  if [ "\$RELOAD_MODE" = 'docker' ]; then
    if docker exec "\$CONTAINER" nginx -t && docker exec "\$CONTAINER" nginx -s reload; then
      log "\${DOMAIN}：证书已更新，容器 \$CONTAINER 已 reload"
      report_sync success
    else
      log "\${DOMAIN}：证书已更新，但容器 \$CONTAINER reload 失败，请手动检查"
      report_sync error
    fi
  else
    if "\$NGINX_BIN" -t && "\$NGINX_BIN" -s reload; then
      log "\${DOMAIN}：证书已更新，nginx 已 reload"
      report_sync success
    else
      log "\${DOMAIN}：证书已更新，但 nginx reload 失败（未安装 nginx 或路径不对？），请手动 reload"
      report_sync error
    fi
  fi
done
`;
}

/** 一键安装脚本：写入该域名的 conf（Token/地址都嵌在 conf 里），首次安装时落同步脚本与定时任务 */
function installScript(base: string, token: string, domain: string): string {
  return `#!/usr/bin/env bash
# Acme Manager 证书分发一键安装（由管理端生成）
set -euo pipefail

if [ "\$(id -u)" != 0 ]; then
  echo '错误：请以 root 运行（命令末尾带 sudo bash）' >&2
  exit 1
fi

MANAGER='${base}'
TOKEN='${token}'
DOMAIN='${domain}'
RELOAD_MODE='nginx'
CONTAINER=''
CERT_DIR="/etc/nginx/certs/\$DOMAIN"

while [ \$# -gt 0 ]; do
  case "\$1" in
    --docker)
      RELOAD_MODE='docker'
      CONTAINER="\${2:-}"
      [ -n "\$CONTAINER" ] || { echo '错误：--docker 需要跟容器名' >&2; exit 1; }
      shift 2 ;;
    --dir)
      CERT_DIR="\${2:-}"
      [ -n "\$CERT_DIR" ] || { echo '错误：--dir 需要跟目录' >&2; exit 1; }
      shift 2 ;;
    *)
      echo "错误：未知参数 \$1（可用：--docker <容器名> / --dir <证书目录>）" >&2
      exit 1 ;;
  esac
done

slug=\$(printf '%s' "\$DOMAIN" | tr -c 'a-zA-Z0-9' '-' | cut -c1-50)
CONF_DIR='/etc/acme-distribute'
mkdir -p "\$CONF_DIR"

cat > "\$CONF_DIR/\$slug.conf" <<CONF_EOF
# 由 Acme Manager 安装脚本生成；删除此文件即停用该域名的同步
MANAGER='\$MANAGER'
TOKEN='\$TOKEN'
DOMAIN='\$DOMAIN'
CERT_DIR='\$CERT_DIR'
RELOAD_MODE='\$RELOAD_MODE'
CONTAINER='\$CONTAINER'
CONF_EOF
chmod 600 "\$CONF_DIR/\$slug.conf"

# 同步脚本始终覆写，确保最新版（含 report 回调）被安装；多张证书重复执行也只是覆写相同内容
cat > /usr/local/bin/acme-distribute-pull <<'PULL_EOF'
${pullScriptBody()}PULL_EOF
chmod 755 /usr/local/bin/acme-distribute-pull

if [ ! -f /etc/cron.d/acme-distribute ]; then
  cat > /etc/cron.d/acme-distribute <<'CRON_EOF'
# Acme Manager 证书分发：每天 04:35 同步一次（管理机默认 03:00 续期）
35 4 * * * root /usr/local/bin/acme-distribute-pull >> /var/log/acme-distribute.log 2>&1
CRON_EOF
fi

echo "→ 立即同步一次 \$DOMAIN …"
/usr/local/bin/acme-distribute-pull -v || true

# 向管理机上报本机配置（best-effort，失败不影响安装）
curl -fsS -X POST -H "Authorization: Bearer \$TOKEN" \\
  "\$MANAGER/api/distribute/report?domain=\$DOMAIN&action=install&reloadMode=\$RELOAD_MODE&container=\$CONTAINER&certDir=\$CERT_DIR" || true

echo
echo '安装完成：'
echo "  证书目录：\$CERT_DIR"
echo "  nginx 配置：ssl_certificate     \$CERT_DIR/fullchain.pem;"
echo "             ssl_certificate_key \$CERT_DIR/privkey.pem;"
echo '  定时任务：/etc/cron.d/acme-distribute（每天 04:35）'
echo '  手动同步：/usr/local/bin/acme-distribute-pull'
echo '  卸载：    rm -rf /etc/acme-distribute /usr/local/bin/acme-distribute-pull /etc/cron.d/acme-distribute /var/log/acme-distribute.log'
`;
}

export async function distributeRoutes(app: FastifyInstance): Promise<void> {
  /** Token 仅管理员可读（GET 对 viewer 放行，必须在路由内拦截） */
  app.get('/distribute/token', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: '需要管理员权限' });
    return { token: getDistributeToken() };
  });

  app.post('/distribute/token', async (req) => {
    const had = getDistributeToken() !== null;
    const token = crypto.randomBytes(24).toString('hex');
    setSetting('distributeToken', token);
    logEvent(
      had ? 'warn' : 'info',
      `分发 Token 已${had ? '重新生成（旧 Token 立即失效）' : '创建'}（操作者 ${req.user!.username}）`,
    );
    return { token };
  });

  app.delete('/distribute/token', async (req) => {
    setSetting('distributeToken', '');
    logEvent('warn', `分发 Token 已吊销（操作者 ${req.user!.username}），所有机器的自动同步将失败`);
    return { ok: true };
  });

  /** 证书内容下载：供目标机器的同步脚本调用（认证钩子按 Bearer Token 放行） */
  app.get('/distribute/file', async (req, reply) => {
    const { domain, type } = (req.query ?? {}) as { domain?: string; type?: string };
    if (!domain) return reply.code(400).send({ error: '缺少 domain 参数' });
    if (type !== 'fullchain' && type !== 'key') {
      return reply.code(400).send({ error: 'type 需为 fullchain 或 key' });
    }
    const cert = certByDomain(domain.trim().toLowerCase());
    if (!cert) return reply.code(404).send({ error: `证书不存在：${domain}` });
    const files = filesFor(cert);
    const file = type === 'key' ? (cert.keyPath ?? files.key) : (cert.certPath ?? files.fullchain);
    if (!fs.existsSync(file)) {
      return reply.code(404).send({ error: '证书文件不存在（证书可能尚未签发成功）' });
    }
    // 兜底记录：即使目标机用旧版同步脚本（无 report 回调），管理侧也能感知到拉取活动
    upsertDistributeTarget(cert.primaryDomain, req.ip ?? '', 'sync', { status: 'success' });
    reply.header('content-type', 'application/x-pem-file');
    reply.header('cache-control', 'no-store');
    return reply.send(fs.createReadStream(file));
  });

  /** 目标机上报安装配置或同步结果（认证钩子按 Bearer Token 放行） */
  app.post('/distribute/report', async (req, reply) => {
    const { domain, action, reloadMode, container, certDir, status, message } = (req.query ?? {}) as {
      domain?: string;
      action?: string;
      reloadMode?: string;
      container?: string;
      certDir?: string;
      status?: string;
      message?: string;
    };
    if (!domain || !action) return reply.code(400).send({ error: '缺少 domain 或 action 参数' });
    if (action !== 'install' && action !== 'sync') {
      return reply.code(400).send({ error: 'action 需为 install 或 sync' });
    }
    const normalizedDomain = domain.trim().toLowerCase();
    const ip = req.ip ?? '';

    // 同步失败告警：仅当上次状态非 error 时推送（避免持续失败轰炸）
    if (action === 'sync' && status === 'error') {
      const existing = db
        .select()
        .from(distributeTargets)
        .where(eq(distributeTargets.primaryDomain, normalizedDomain))
        .all()
        .find((r) => r.ip === (ip || '未知'));
      if (!existing || existing.lastSyncStatus !== 'error') {
        const ev: NotifyEvent = {
          event: 'distribute.sync.failed',
          title: '❌ [Acme Manager] 证书分发同步失败',
          message: [
            `域名：${normalizedDomain}`,
            `目标服务器：${ip || '未知'}`,
            `错误：${message || '同步失败（详情见目标机 /var/log/acme-distribute.log）'}`,
          ].join('\n'),
          ok: false,
          domain: normalizedDomain,
          error: message || 'sync failed',
        };
        await notifyQuietly(ev);
      }
    }

    upsertDistributeTarget(normalizedDomain, ip, action, {
      reloadMode,
      container,
      certDir,
      status,
      message,
    });
    return { ok: true };
  });

  /** 查询某域名的分发目标列表（需管理员会话认证） */
  app.get('/distribute/targets', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: '需要管理员权限' });
    const { domain } = (req.query ?? {}) as { domain?: string };
    if (!domain) return reply.code(400).send({ error: '缺少 domain 参数' });
    const rows = db
      .select()
      .from(distributeTargets)
      .where(eq(distributeTargets.primaryDomain, domain.trim().toLowerCase()))
      .orderBy(desc(distributeTargets.updatedAt))
      .all();
    const staleThreshold = Date.now() - 7 * 86_400_000;
    const targets = rows.map((r) => ({
      ...r,
      tags: r.tags ? r.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      stale: r.lastSyncAt ? new Date(r.lastSyncAt).getTime() < staleThreshold : r.firstSeenAt ? new Date(r.firstSeenAt).getTime() < staleThreshold : true,
    }));
    return { targets };
  });

  /** 一键安装脚本：嵌入管理机地址、Token 与域名 */
  app.get('/distribute/install.sh', async (req, reply) => {
    const { domain } = (req.query ?? {}) as { domain?: string };
    if (!domain) return reply.code(400).send({ error: '缺少 domain 参数' });
    const token = getDistributeToken();
    if (!token) return reply.code(400).send({ error: '尚未创建分发 Token' });
    const cert = certByDomain(domain.trim().toLowerCase());
    if (!cert) return reply.code(404).send({ error: `证书不存在：${domain}` });
    const base = `${req.protocol}://${req.headers.host}`;
    logEvent('info', `分发安装命令被获取：${cert.primaryDomain}（目标机器 ${req.ip}）`);
    upsertDistributeTarget(cert.primaryDomain, req.ip ?? '', 'install');
    reply.header('content-type', 'text/x-shellscript; charset=utf-8');
    reply.header('cache-control', 'no-store');
    return reply.send(installScript(base, token, cert.primaryDomain));
  });

  /** 删除分发目标记录（需管理员会话认证） */
  app.delete<{ Params: { id: string } }>('/distribute/targets/:id', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: '需要管理员权限' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: '无效的 ID' });
    db.delete(distributeTargets).where(eq(distributeTargets.id, id)).run();
    return { ok: true };
  });

  /** 更新分发目标标签（需管理员会话认证） */
  app.patch<{ Params: { id: string } }>('/distribute/targets/:id', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: '需要管理员权限' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: '无效的 ID' });
    const body = (req.body ?? {}) as { tags?: string[] };
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => t.trim()).filter(Boolean).join(',') : '';
    db.update(distributeTargets)
      .set({ tags: tags || null, updatedAt: new Date().toISOString() })
      .where(eq(distributeTargets.id, id))
      .run();
    return { ok: true };
  });
}
