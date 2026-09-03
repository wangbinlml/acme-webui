import fs from 'node:fs';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates } from '../db/schema.js';
import { filesFor } from '../services/certificates.js';
import { getDistributeToken, setSetting } from '../services/settings.js';
import { logEvent } from '../services/logger.js';

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

for conf in /etc/acme-distribute/*.conf; do
  [ -f "\$conf" ] || continue
  # shellcheck disable=SC1090
  . "\$conf"

  tmp=\$(mktemp -d) || continue
  if ! curl -fsS -o "\$tmp/fullchain.pem" -H "Authorization: Bearer \$TOKEN" \\
      "\$MANAGER/api/distribute/file?domain=\$DOMAIN&type=fullchain"; then
    log "\${DOMAIN}：下载 fullchain 失败（管理机不可达 / Token 已失效 / 证书未签发），跳过"
    rm -rf "\$tmp"; continue
  fi
  if ! curl -fsS -o "\$tmp/privkey.pem" -H "Authorization: Bearer \$TOKEN" \\
      "\$MANAGER/api/distribute/file?domain=\$DOMAIN&type=key"; then
    log "\${DOMAIN}：下载 privkey 失败，跳过"
    rm -rf "\$tmp"; continue
  fi

  if [ -f "\$CERT_DIR/fullchain.pem" ] && [ -f "\$CERT_DIR/privkey.pem" ] \\
     && cmp -s "\$tmp/fullchain.pem" "\$CERT_DIR/fullchain.pem" \\
     && cmp -s "\$tmp/privkey.pem" "\$CERT_DIR/privkey.pem"; then
    [ -n "\$VERBOSE" ] && log "\${DOMAIN}：证书无变化"
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
    else
      log "\${DOMAIN}：证书已更新，但容器 \$CONTAINER reload 失败，请手动检查"
    fi
  else
    if "\$NGINX_BIN" -t && "\$NGINX_BIN" -s reload; then
      log "\${DOMAIN}：证书已更新，nginx 已 reload"
    else
      log "\${DOMAIN}：证书已更新，但 nginx reload 失败（未安装 nginx 或路径不对？），请手动 reload"
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

# 同步脚本与定时任务全局只装一份，多张证书重复执行本命令不会重复安装
if [ ! -x /usr/local/bin/acme-distribute-pull ]; then
  cat > /usr/local/bin/acme-distribute-pull <<'PULL_EOF'
${pullScriptBody()}PULL_EOF
  chmod 755 /usr/local/bin/acme-distribute-pull
fi

if [ ! -f /etc/cron.d/acme-distribute ]; then
  cat > /etc/cron.d/acme-distribute <<'CRON_EOF'
# Acme Manager 证书分发：每天 04:35 同步一次（管理机默认 03:00 续期）
35 4 * * * root /usr/local/bin/acme-distribute-pull >> /var/log/acme-distribute.log 2>&1
CRON_EOF
fi

echo "→ 立即同步一次 \$DOMAIN …"
/usr/local/bin/acme-distribute-pull -v || true

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
    reply.header('content-type', 'application/x-pem-file');
    reply.header('cache-control', 'no-store');
    return reply.send(fs.createReadStream(file));
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
    reply.header('content-type', 'text/x-shellscript; charset=utf-8');
    reply.header('cache-control', 'no-store');
    return reply.send(installScript(base, token, cert.primaryDomain));
  });
}
