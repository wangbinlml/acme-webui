#!/bin/sh
set -e

# 首次启动时把 acme.sh 安装到 $ACME_MANAGER_HOME/acme.sh（与宿主机 ~/.acme.sh 完全隔离）
# acme.sh 主脚本是自包含单文件，但 DNS API 插件在 dnsapi/ 目录（DNS-01 必需，缺了会报
# "Cannot find DNS API hook"），两者都要复制。account.conf 等状态文件在首次签发时自动生成。
# 不用 --install（其内部 cp 受 cwd 影响），也不要它自带的 cron——续期由本服务自己调度
ACME_DIR="$ACME_MANAGER_HOME/acme.sh"
if [ ! -f "$ACME_DIR/acme.sh" ] || [ ! -d "$ACME_DIR/dnsapi" ]; then
  echo "[entrypoint] 正在安装 acme.sh 到 $ACME_DIR ..."
  TMP_DIR="$(mktemp -d)"
  if curl -fsSL https://github.com/acmesh-official/acme.sh/archive/master.tar.gz \
      | tar xz -C "$TMP_DIR"; then
    mkdir -p "$ACME_DIR"
    if cp "$TMP_DIR/acme.sh-master/acme.sh" "$ACME_DIR/acme.sh" \
      && chmod +x "$ACME_DIR/acme.sh" \
      && cp -r "$TMP_DIR/acme.sh-master/dnsapi" "$ACME_DIR/dnsapi"; then
      echo "[entrypoint] acme.sh 安装完成（含 $(ls "$ACME_DIR/dnsapi" | wc -l) 个 DNS 插件）"
    else
      echo "[entrypoint] 警告：acme.sh 安装失败，可稍后重启容器重试"
    fi
  else
    echo "[entrypoint] 警告：acme.sh 下载失败（网络原因？），可稍后重启容器重试"
  fi
  rm -rf "$TMP_DIR"
fi

mkdir -p "$ACME_MANAGER_HOME/data" "$ACME_MANAGER_HOME/storage/certificates"

echo "[entrypoint] 启动 Acme Manager ..."
exec node server/dist/index.js
