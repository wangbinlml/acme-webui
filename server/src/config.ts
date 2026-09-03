import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 默认以进程工作目录为应用根目录（Docker 中 WORKDIR=/app）
const appRoot = process.env.ACME_MANAGER_HOME ?? process.cwd();

function envOr(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const storageDir = envOr('STORAGE_DIR', path.join(appRoot, 'storage'));

/**
 * 容器内运行时，从 /proc/self/mountinfo 找出 bind 挂载（如 ./storage → /app/storage）
 * 对应的宿主机路径（mountinfo 第 4 列 root 字段）。Docker / OrbStack 均适用。
 * 非容器或识别不出时返回 null（此时容器内路径本身就是宿主机路径）。
 */
function detectHostStorageDir(): string | null {
  if (!fs.existsSync('/.dockerenv')) return null;
  let info: string;
  try {
    info = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  } catch {
    return null;
  }
  let best: { mountpoint: string; root: string } | null = null;
  for (const line of info.split('\n')) {
    const parts = line.split(' ');
    if (parts.length < 5) continue;
    const root = parts[3];
    const mountpoint = parts[4];
    if (!mountpoint || mountpoint === '/') continue;
    if (storageDir === mountpoint || storageDir.startsWith(`${mountpoint}/`)) {
      if (!best || mountpoint.length > best.mountpoint.length) best = { mountpoint, root };
    }
  }
  // root 为 '/' 的是镜像自身层（overlay），映射不出宿主机路径
  if (!best || !best.root || best.root === '/') return null;
  return `${best.root}${storageDir.slice(best.mountpoint.length)}`;
}

// 版本号唯一来源是 server/package.json；src 与 dist 到它的相对层级一致
function readVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const config = {
  version: readVersion(),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: envOr('DATA_DIR', path.join(appRoot, 'data')),
  dbFile: envOr('DB_FILE', path.join(appRoot, 'data', 'acme.db')),
  storageDir,
  // storage 在宿主机上的位置：HOST_STORAGE_DIR 显式指定，否则自动识别 bind 挂载
  hostStorageDir: envOr('HOST_STORAGE_DIR', '') || detectHostStorageDir(),
  certDir: envOr('CERT_DIR', path.join(appRoot, 'storage', 'certificates')),
  acmeHome: envOr('ACME_HOME', path.join(appRoot, 'acme.sh')),
  acmeBin: envOr('ACME_BIN', path.join(appRoot, 'acme.sh', 'acme.sh')),
  acmeLogFile: envOr('ACME_LOG_FILE', path.join(appRoot, 'data', 'acme.sh.log')),
  webDist: envOr('WEB_DIST', path.join(appRoot, 'web', 'dist')),
  renewCron: process.env.RENEW_CRON ?? '0 3 * * *',
};

export function ensureDirs(): void {
  for (const dir of [config.dataDir, config.storageDir, config.certDir, config.acmeHome]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function acmeAvailable(): boolean {
  return fs.existsSync(config.acmeBin);
}
