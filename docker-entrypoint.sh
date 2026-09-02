#!/bin/sh
set -e

# 首次启动时把 acme.sh 安装到 $ACME_MANAGER_HOME/acme.sh（与宿主机 ~/.acme.sh 完全隔离）
# acme.sh 是自包含单文件脚本：直接从 GitHub 下载并复制即可运行；
# account.conf 等状态文件在首次签发时自动生成。不用 --install（其内部 cp 受 cwd 影响），
# 也不要它自带的 cron（--nocron 语义）——续期由本服务自己的数据库 + 定时扫描驱动
ACME_DIR="$ACME_MANAGER_HOME/acme.sh"
if [ ! -f "$ACME_DIR/acme.sh" ]; then
  echo "[entrypoint] 正在安装 acme.sh 到 $ACME_DIR ..."
  TMP_DIR="$(mktemp -d)"
  if curl -fsSL https://github.com/acmesh-official/acme.sh/archive/master.tar.gz \
      | tar xz -C "$TMP_DIR"; then
    mkdir -p "$ACME_DIR"
    cp "$TMP_DIR/acme.sh-master/acme.sh" "$ACME_DIR/acme.sh" \
      && chmod +x "$ACME_DIR/acme.sh" \
      && echo "[entrypoint] acme.sh 安装完成" \
      || echo "[entrypoint] 警告：acme.sh 安装失败，可稍后重启容器重试"
  else
    echo "[entrypoint] 警告：acme.sh 下载失败（网络原因？），可稍后重启容器重试"
  fi
  rm -rf "$TMP_DIR"
fi

mkdir -p "$ACME_MANAGER_HOME/data" "$ACME_MANAGER_HOME/storage/certificates"

echo "[entrypoint] 启动 Acme Manager ..."
exec node server/dist/index.js
