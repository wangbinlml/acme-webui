import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { logEvent } from './logger.js';

export type BackupMode = 'full' | 'config';

export interface BackupResult {
  data: Buffer;
  filename: string;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 递归复制目录（跳过 .DS_Store 等系统杂项文件） */
function copyDirFiltered(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirFiltered(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

/** tar 打包 staging 目录，stdout 收集为 Buffer（Debian slim 与 macOS 均自带 tar） */
function tarGz(dir: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-czf', '-', '-C', dir, '.']);
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', (e) => reject(new Error(`无法启动 tar：${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`tar 打包失败（exit ${code}）：${stderr.trim()}`));
    });
  });
}

export async function createBackup(mode: BackupMode): Promise<BackupResult> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-backup-'));
  try {
    // 数据库用 backup API 做一致性快照，主连接（含 WAL 中的写入）不受影响
    fs.mkdirSync(path.join(staging, 'data'), { recursive: true });
    const dbPath = path.join(staging, 'data', 'acme.db');
    const src = new Database(config.dbFile, { readonly: true });
    try {
      await src.backup(dbPath);
    } finally {
      src.close();
    }

    if (mode === 'config') {
      // 剔除敏感信息与用户数据：DNS 凭据置空、通知/SMTP 密钥、用户、会话、日志全部清除
      const scrub = new Database(dbPath);
      try {
        scrub.exec(`
          UPDATE dns_providers SET credentials = '{}';
          DELETE FROM settings WHERE key LIKE 'notify%' OR key LIKE 'smtp%';
          DELETE FROM sessions;
          DELETE FROM users;
          DELETE FROM logs;
        `);
      } finally {
        scrub.close();
      }
    } else {
      // 完整备份：证书文件与 acme.sh 账户一并打包
      if (fs.existsSync(config.storageDir)) {
        copyDirFiltered(config.storageDir, path.join(staging, 'storage'));
      }
      if (fs.existsSync(config.acmeHome)) {
        copyDirFiltered(config.acmeHome, path.join(staging, 'acme.sh'));
      }
    }

    const data = await tarGz(staging);
    const filename = `acme-manager-backup-${timestamp()}-${mode}.tar.gz`;
    logEvent(
      'info',
      `已导出${mode === 'full' ? '完整' : '仅配置'}备份 ${filename}（${(data.length / 1024 / 1024).toFixed(1)} MB）`,
    );
    return { data, filename };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
