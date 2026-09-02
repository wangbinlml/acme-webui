# syntax=docker/dockerfile:1

# ============================================================
# 阶段 1：构建前端
# ============================================================
FROM node:22-bookworm-slim AS web-build

# pnpm 镜像源可通过 --build-arg 覆盖
ARG NPM_REGISTRY=https://registry.npmmirror.com

RUN npm config set registry ${NPM_REGISTRY} \
    && npm install -g pnpm@10

WORKDIR /build/web

COPY web/package.json web/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY web/ ./

RUN pnpm build


# ============================================================
# 阶段 2：构建后端
# better-sqlite3 需要 python3 + make + g++
# ============================================================
FROM node:22-bookworm-slim AS server-build

ARG DEBIAN_MIRROR=mirrors.aliyun.com
ARG NPM_REGISTRY=https://registry.npmmirror.com

# Debian 软件源切换到国内镜像
RUN sed -i "s/deb.debian.org/${DEBIAN_MIRROR}/g" \
        /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

# pnpm 使用国内镜像
RUN npm config set registry ${NPM_REGISTRY} \
    && npm install -g pnpm@10

WORKDIR /build/server

COPY server/package.json server/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY server/ ./

RUN pnpm build


# ============================================================
# 阶段 3：运行时
# ============================================================
FROM node:22-bookworm-slim

ARG DEBIAN_MIRROR=mirrors.aliyun.com

# 运行 acme.sh + HTTP-01 standalone 所需依赖
RUN sed -i "s/deb.debian.org/${DEBIAN_MIRROR}/g" \
        /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        socat \
        ca-certificates \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    ACME_MANAGER_HOME=/app \
    TZ=Asia/Shanghai

WORKDIR /app


# ============================================================
# 后端
# ============================================================

# 生产依赖
COPY --from=server-build \
    /build/server/node_modules \
    ./server/node_modules

# 编译产物
COPY --from=server-build \
    /build/server/dist \
    ./server/dist

# Drizzle
COPY --from=server-build \
    /build/server/drizzle \
    ./server/drizzle

COPY --from=server-build \
    /build/server/package.json \
    ./server/package.json


# ============================================================
# 前端
# ============================================================

COPY --from=web-build \
    /build/web/dist \
    ./web/dist


# ============================================================
# EntryPoint
# ============================================================

COPY docker-entrypoint.sh \
    /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh


# ============================================================
# 网络
# ============================================================

# 3000 Web UI
# 80 HTTP-01 standalone 验证
EXPOSE 3000 80


# ============================================================
# 持久化目录
# ============================================================

VOLUME [
    "/app/data",
    "/app/storage",
    "/app/acme.sh"
]


ENTRYPOINT ["docker-entrypoint.sh"]
