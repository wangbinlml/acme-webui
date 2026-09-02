# ---------- 阶段 1：构建前端 ----------
FROM node:22-bookworm-slim AS web-build
RUN npm install -g pnpm@10
WORKDIR /build/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# ---------- 阶段 2：构建后端（better-sqlite3 需要原生编译） ----------
FROM node:22-bookworm-slim AS server-build
RUN npm install -g pnpm@10
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /build/server
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY server/ ./
RUN pnpm build

# ---------- 阶段 3：运行时 ----------
FROM node:22-bookworm-slim
# curl/socat：entrypoint 安装 acme.sh 与 HTTP-01 standalone 验证需要
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl socat ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    ACME_MANAGER_HOME=/app \
    TZ=Asia/Shanghai

WORKDIR /app

# 后端产物：dist + 生产依赖（沿用构建阶段的 node_modules，含已编译的 better-sqlite3）
COPY --from=server-build /build/server/node_modules ./server/node_modules
COPY --from=server-build /build/server/dist ./server/dist
COPY --from=server-build /build/server/drizzle ./server/drizzle
COPY --from=server-build /build/server/package.json ./server/package.json
# 前端静态文件
COPY --from=web-build /build/web/dist ./web/dist
# entrypoint
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 3000 Web UI；80 供 HTTP-01 standalone 验证（不需要可不放行）
EXPOSE 3000 80

VOLUME ["/app/data", "/app/storage", "/app/acme.sh"]

ENTRYPOINT ["docker-entrypoint.sh"]
