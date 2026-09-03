# Acme Manager

独立的 SSL 证书管理器（类似宝塔 SSL 模块）：以 [acme.sh](https://github.com/acmesh-official/acme.sh) 为签发引擎，自带证书配置、ACME 账户、自动续期调度与 Web 管理界面，支持 Let's Encrypt / ZeroSSL，HTTP-01 / DNS-01 双验证，通配符证书。

**与服务器上已有的 `/root/.acme.sh` 完全隔离**：本工具使用独立的 acme.sh 目录（`/app/acme.sh`）、独立的证书存储（`/app/storage/certificates`）、独立的 SQLite 配置库（`/app/data/acme.db`），删除或重新部署本工具不会影响服务器上现有的任何证书。

## 功能

- **仪表盘**：证书总数 / 正常 / 即将过期 / 异常一览，最近签发的证书
- **证书管理**：签发、续期、重新签发、下载（fullchain / cert / key / CA）、删除、详情（解析证书 Subject / SAN / 指纹 / 剩余天数）
- **创建证书**：主域名 + SAN 多域名、通配符（自动强制 DNS-01）、CA 二选一（Let's Encrypt / ZeroSSL）、密钥算法（EC-256 / EC-384 / RSA-2048）
- **DNS API**：Cloudflare / 腾讯云 DNSPod / 阿里云 / 华为云 / GoDaddy / Namecheap / AWS Route53，凭据入库（编辑时脱敏显示），Cloudflare 与 DNSPod 支持真实「测试连接」
- **自动续期**：自有数据库调度，每天 03:00 扫描，剩余天数低于阈值（默认 30，每张证书可调）自动续期，成功更新状态、失败记日志
- **日志**：acme.sh 输出实时流（SSE，含断线回放）+ 历史日志查询
- **通知推送**：企业微信 / 飞书群机器人，续期成功 / 失败自动推送（含域名、CA、新到期时间 / 错误摘要），飞书支持签名校验，设置页可发送测试消息
- **多用户与登录认证**：首次访问初始化管理员；admin（全部权限）/ viewer（只读）两种角色；HttpOnly Cookie 会话（7 天）；登录失败 5 次锁定 10 分钟；用户管理页支持添加、重置密码、改角色、删除

## 架构

```
┌─────────────────────────────────────────────┐
│  浏览器  Vue 3 + Element Plus + Vite        │
└───────────────────┬─────────────────────────┘
                    │ HTTP / SSE
┌───────────────────▼─────────────────────────┐
│  Node.js 22 + Fastify (TypeScript)          │
│  · 证书 / DNS / 日志 / 设置 REST API         │
│  · 签发队列（串行） + 续期扫描 (node-cron)    │
│  · SQLite (better-sqlite3 + Drizzle ORM)    │
└───────┬──────────────────────────┬──────────┘
        │ 子进程                    │ 文件
┌───────▼─────────┐   ┌────────────▼──────────┐
│  acme.sh (独立)  │   │ data/acme.db           │
│  ~acme/acme.sh  │   │ storage/certificates/  │
└───────┬─────────┘   └────────────────────────┘
        │ ACME 协议
┌───────▼─────────┐
│ Let's Encrypt / │
│ ZeroSSL         │
└─────────────────┘
```

## 快速开始（Docker）

```bash
git clone <repo> acme-manager && cd acme-manager
docker compose up -d --build
docker compose down
```

打开 http://127.0.0.1:28080 （默认只绑定本机回环地址）。

使用流程：

1. 首次打开按提示**初始化管理员账号**（用户名 + 密码，仅一次）；其他成员可在「用户管理」页添加（可设为只读 viewer）
2. **DNS API** 页添加 DNS Provider（如 Cloudflare 的 API Token），点「测试连接」确认可用
3. **设置** 页填写账户邮箱（ZeroSSL 必需，Let's Encrypt 建议填写）；按需在「通知推送」配置企业微信 / 飞书群机器人并点「保存并发送测试」
4. **证书管理 → 创建证书**：填主域名 / SAN，选 CA、算法、验证方式（DNS-01 需选 Provider），创建后自动开始签发，详情页可看 acme.sh 实时输出
5. 签发成功后即可在详情页下载 `fullchain.pem` / `privkey.pem`，或直接从宿主机 `./storage/certificates/<主域名>/`（如 `szzh.vip/`、`szzh.vip-wildcard/`） 取用
6. 需要证书落库后自动同步给 nginx/Caddy？在证书详情页「自动部署」里配置（见下节）

## 证书自动部署（Nginx / Caddy / Docker 容器）

签发或续期成功后，自动把证书复制到目标目录 `<目标目录>/<主域名>/`（含 fullchain / privkey / cert / chain，私钥权限 600），并按选择的 **reload 方式**触发服务重载（平滑 reload，不断连接）：

| reload 方式 | 适用场景 | 说明 |
|---|---|---|
| 仅复制 | 宿主机 nginx / 任意服务 | 只复制文件，由宿主机侧自行触发重载（见下方 systemd/cron 方案） |
| 容器内命令 | 有钩子可调的场景 | 在本工具容器里执行任意 shell 命令，如 `curl` 调宿主机钩子、`ssh` 到目标机 |
| Docker 容器 | nginx/Caddy 跑在容器里 | 通过挂载的 docker.sock 直接 `docker exec` 到指定容器执行 reload，无需安装 docker CLI |

### 场景一：宿主机 nginx（非 Docker 部署）

容器里的工具无法直接操作宿主机 shell，标准做法是**文件经挂载目录直达宿主机 + reload 在宿主机侧触发**：

1. `docker-compose.yml` 取消注释 `- ./deploy:/deploy`；
2. 证书详情页「自动部署」：目标目录填 `/deploy/nginx-certs`，reload 方式选「仅复制」；
3. 宿主机 nginx 直接引用该目录（`./deploy/nginx-certs/<域名>/fullchain.pem`）：

   ```nginx
   ssl_certificate     /opt/acme-manager/deploy/nginx-certs/szzh.vip/fullchain.pem;
   ssl_certificate_key /opt/acme-manager/deploy/nginx-certs/szzh.vip/privkey.pem;
   ```

4. reload 触发二选一（文件更新后自动执行 `nginx -s reload`）：
   - **systemd path 监控（推荐，即时）**：

     ```ini
     # /etc/systemd/system/acme-deploy-reload.path
     [Unit]
     Description=Watch acme-manager deployed certs
     [Path]
     PathModified=/opt/acme-manager/deploy/nginx-certs
     Unit=acme-deploy-reload.service
     [Install]
     WantedBy=multi-user.target
     ```
     ```ini
     # /etc/systemd/system/acme-deploy-reload.service
     [Unit]
     Description=Reload nginx after cert deploy
     [Service]
     Type=oneshot
     ExecStart=/usr/sbin/nginx -s reload
     ```
     `systemctl enable --now acme-deploy-reload.path`
   - **cron 定时 reload（最简，最多延迟一个周期）**：`30 4 * * * /usr/sbin/nginx -s reload`（reload 幂等无害）

   若宿主机上跑着一个极简 HTTP 钩子服务，也可以选「容器内命令」填 `curl -fsS http://宿主机IP:9090/reload` 即时触发。

### 场景二：nginx / Caddy 跑在 Docker 容器里

1. `docker-compose.yml` 取消注释 `- /var/run/docker.sock:/var/run/docker.sock`（并让 nginx 容器挂载同一个证书目录）；
2. 证书详情页「自动部署」：目标目录填容器内共享路径（如 `/deploy/nginx-certs`），reload 方式选「Docker 容器」，填容器名（如 `webserver`）与命令（默认 `nginx -s reload`；Caddy 填 `caddy reload --config /etc/caddy/Caddyfile`）。

配置后可点「立即部署」验证（返回 reload 命令的完整输出），每次部署结果记录在证书详情与系统日志中；部署失败不影响证书状态本身。

> HTTP-01（standalone）验证要求宿主机 80 端口空闲且公网可达，compose 默认**不映射** 80 端口（避免与服务器上已有的 Web 服务冲突，被占用时报 `bind: address already in use`）；只用 DNS-01 时无需任何改动。确需 HTTP-01 时，在 docker-compose.yml 里取消 `- "80:80"` 的注释。

## 本地开发

```bash
# 后端（:3000，热重载）
cd server && pnpm install && pnpm dev

# 前端（:5173，代理到后端）
cd web && pnpm install && pnpm dev

# 本地想真正签发时，先装一份独立的 acme.sh（不会动 ~/.acme.sh）。
# 注：get.acme.sh 的管道安装目前转发 --home 参数有 bug（报 Unknown parameter: ----home），
# 与 docker-entrypoint.sh 一致，直接从 GitHub 下载；主脚本之外必须带上 dnsapi/ 插件目录（DNS-01 必需）：
curl -fsSL https://github.com/acmesh-official/acme.sh/archive/master.tar.gz | tar xz
mkdir -p acme.sh && cp acme.sh-master/acme.sh acme.sh/ && chmod +x acme.sh/acme.sh
cp -R acme.sh-master/dnsapi acme.sh/dnsapi && rm -rf acme.sh-master
```

测试数据目录可用环境变量重定向：`ACME_MANAGER_HOME=/tmp/acme-test node server/dist/index.js`。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ACME_MANAGER_HOME` | 进程工作目录 | 应用根目录，所有相对路径的基准（Docker 中为 `/app`） |
| `PORT` | `3000` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `<home>/data` | SQLite 数据库目录 |
| `DB_FILE` | `<home>/data/acme.db` | 数据库文件 |
| `STORAGE_DIR` | `<home>/storage` | 证书存储根目录 |
| `CERT_DIR` | `<home>/storage/certificates` | 证书文件输出目录 |
| `ACME_HOME` | `<home>/acme.sh` | acme.sh 安装目录（独立于系统已有 acme.sh） |
| `ACME_BIN` | `<home>/acme.sh/acme.sh` | acme.sh 可执行文件路径 |
| `ACME_LOG_FILE` | `<home>/data/acme.sh.log` | acme.sh 子进程输出重定向的日志文件 |
| `WEB_DIST` | `<home>/web/dist` | 前端静态文件目录（不存在则只提供 API） |
| `RENEW_CRON` | `0 3 * * *` | 自动续期扫描计划（node-cron 语法，服务器时区） |

## 目录结构

```
acme-manager/
├── docker-compose.yml
├── docker-entrypoint.sh      # 首次启动安装独立 acme.sh（--nocron）
├── Dockerfile                # 三阶段构建：web → server → 运行时
├── server/                   # Fastify + TypeScript 后端
│   ├── src/
│   │   ├── config.ts         # 环境变量与目录
│   │   ├── db/               # Drizzle schema + 迁移
│   │   ├── services/         # acme.sh 封装 / 签发流程 / 队列 / SSE 日志
│   │   └── routes/           # REST API
│   └── drizzle/              # 生成的迁移文件
├── web/                      # Vue 3 + Element Plus 前端
└── （运行时生成）
    ├── data/acme.db          # 证书配置 / DNS 凭据 / 日志
    ├── storage/certificates/ # <主域名>/{fullchain,privkey,cert,chain}.pem（通配符为 <域名>-wildcard）
    └── acme.sh/              # 独立的 acme.sh 与 ACME 账户
```

## 工作原理

- **签发**：后端以子进程运行 acme.sh `--issue`，通过环境变量注入 DNS 凭据（不落命令行），日志逐行推送到 SSE。所有 acme.sh 操作经串行队列执行，避免并发冲突
- **证书落盘**：签发成功后用 `--install-cert` 把证书复制到 `storage/certificates/<主域名>/` 固定路径（fullchain.pem / privkey.pem / cert.pem / chain.pem），Web UI 与宿主机都从这里取证书；详情页展示的路径即宿主机路径（自动从容器 bind 挂载识别，识别不准时可用环境变量 `HOST_STORAGE_DIR` 指定），容器内路径以小字附注
- **续期**：不依赖 acme.sh 的 cron（安装时 `--nocron`）。每天 03:00 由本服务扫描数据库，对剩余天数 ≤ 阈值的证书执行 `--renew --force`，结果写回数据库并记录日志
- **通知**：签发 / 续期结束（无论成败，手动或定时触发）后向所有已启用渠道推送。三个渠道可同时启用、互不影响，推送失败仅记日志告警，不影响主流程：
  - **机器人推送**：企业微信 / 飞书群机器人（含飞书签名校验）
  - **Webhook**：向任意地址 POST JSON（`event` / `title` / `message` / `ok` / `domain` / `domains` / `ca` / `expiresAt` / `error` / `version` / `timestamp`），HTTP 2xx 视为成功，`event` 取值 `cert.issue.success|cert.issue.failed|cert.renew.success|cert.renew.failed|test`，适合对接 ntfy / Bark / 自建脚本
  - **邮件**：内置零依赖 SMTP 客户端（465 SSL / 587·25 STARTTLS、AUTH LOGIN/PLAIN、UTF-8 主题与正文），支持多个收件人
- **隔离**：acme.sh 的 `--home` 指向本工具私有目录，账户注册、域名状态、证书缓存全部在内；删除 `data/ storage/ acme.sh/` 三个目录即彻底卸载

## 安全说明

- **登录认证**：所有 API 均需登录会话（HttpOnly Cookie，7 天有效期）；同一用户名连续登录失败 5 次锁定 10 分钟；修改 / 重置密码后其他会话立即下线。会话 Cookie 未加 `Secure` 标记，公网使用请置于 HTTPS 反向代理之后，避免密码明文传输
- **角色**：viewer 只读角色在服务端强制拦截全部写操作，前端按钮隐藏仅为体验优化
- **DNS 凭据与通知密钥保存在 SQLite 中（明文）**：包括 DNS Provider 凭据、通知 Webhook 地址（含企微 key / 飞书 token）、飞书签名密钥、SMTP 密码 / 授权码。请确保 `./data` 目录权限受控；DNS 凭据泄露等同于域名解析控制权泄露
- **私钥文件**：`storage/certificates/<主域名>/privkey.pem` 为明文私钥，备份/迁移时注意权限

## V2 Roadmap

- [x] 证书自动部署：Nginx / Caddy / Docker 容器（reload 钩子）
- [x] Webhook 通知（签发 / 续期成功 / 失败）
- [x] 邮件通知（企业微信 / 飞书机器人推送已在 v1 提供）
- [x] 多用户与登录认证（admin / viewer 角色、登录限速、用户管理）

## 技术栈

Vue 3 · Vite · Element Plus · TypeScript · Node.js 22 · Fastify · better-sqlite3 · Drizzle ORM · node-cron · acme.sh · Docker
