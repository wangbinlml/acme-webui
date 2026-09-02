import fs from 'node:fs';
import path from 'node:path';

// 默认以进程工作目录为应用根目录（Docker 中 WORKDIR=/app）
const appRoot = process.env.ACME_MANAGER_HOME ?? process.cwd();

function envOr(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  version: '0.1.0',
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: envOr('DATA_DIR', path.join(appRoot, 'data')),
  dbFile: envOr('DB_FILE', path.join(appRoot, 'data', 'acme.db')),
  storageDir: envOr('STORAGE_DIR', path.join(appRoot, 'storage')),
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
