import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { config } from '../config.js';

export interface RestoreInfo {
  /** 恢复就位（上传）时间 */
  at: string;
  scope: 'full' | 'config';
}

function tarRun(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('tar', args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.on('error', (e) => resolve({ code: -1, stderr: `无法启动 tar：${e.message}`, stdout: '' }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * 校验上传的备份并就位到 data/restore-pending：
 * 列目录防路径穿越 → 解压 → 确认 data/acme.db 是本应用的库 → rename 到位（同目录不跨文件系统）。
 * 全程失败即抛错，不影响现有数据；成功后只落位不生效，等进程重启时由 applyPendingRestore 应用。
 */
export async function prepareRestore(data: Buffer): Promise<RestoreInfo> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const uploaded = path.join(config.dataDir, `.restore-upload-${Date.now()}.tar.gz`);
  fs.writeFileSync(uploaded, data);
  try {
    const listed = await tarRun(['-tzf', uploaded]);
    if (listed.code !== 0) {
      throw new Error(`不是有效的 tar.gz 备份包：${listed.stderr.trim() || '无法读取'}`);
    }
    for (const raw of listed.stdout.split('\n')) {
      const name = raw.trim().replace(/^\.\//, '');
      if (!name) continue;
      if (path.isAbsolute(name) || name.split('/').includes('..')) {
        throw new Error(`备份包含不安全的路径条目：${raw}`);
      }
    }

    const staging = fs.mkdtempSync(path.join(config.dataDir, 'restore-staging-'));
    try {
      const extracted = await tarRun(['-xzf', uploaded, '-C', staging]);
      if (extracted.code !== 0) throw new Error(`备份包解压失败：${extracted.stderr.trim()}`);

      const dbInArchive = path.join(staging, 'data', 'acme.db');
      if (!fs.existsSync(dbInArchive)) {
        throw new Error('备份包里缺少 data/acme.db（应为「设置 → 备份与恢复」导出的备份）');
      }
      const check = new Database(dbInArchive, { readonly: true });
      try {
        const tables = check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
        const names = new Set(tables.map((t) => t.name));
        for (const required of ['users', 'certificates', 'settings', 'dns_providers']) {
          if (!names.has(required)) throw new Error(`备份数据库缺少表 ${required}，不是本应用的备份`);
        }
      } finally {
        check.close();
      }

      const scope: 'full' | 'config' = fs.existsSync(path.join(staging, 'storage')) ? 'full' : 'config';
      const pending = path.join(config.dataDir, 'restore-pending');
      fs.rmSync(pending, { recursive: true, force: true });
      fs.renameSync(staging, pending);
      const info: RestoreInfo = { at: new Date().toISOString(), scope };
      fs.writeFileSync(path.join(pending, 'marker.json'), JSON.stringify(info));
      return info;
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw e;
    }
  } finally {
    fs.rmSync(uploaded, { force: true });
  }
}

/**
 * 进程启动时（打开数据库前）应用 data/restore-pending 里的备份：
 * 替换 db 前必须删掉旧 WAL/SHM，否则新库会拿旧 WAL 做恢复导致损坏。
 * storage / acme.sh 恢复失败不致命（数据库是事实来源，可重新签发），仅打日志。
 */
export function applyPendingRestore(): RestoreInfo | null {
  const pending = path.join(config.dataDir, 'restore-pending');
  if (!fs.existsSync(pending)) return null;

  let info: RestoreInfo = { at: new Date().toISOString(), scope: 'config' };
  try {
    info = JSON.parse(fs.readFileSync(path.join(pending, 'marker.json'), 'utf8')) as RestoreInfo;
  } catch {
    // marker 缺失/损坏时按实际内容处理，不中断启动
  }

  const dbInPending = path.join(pending, 'data', 'acme.db');
  if (!fs.existsSync(dbInPending)) {
    console.error('[restore] restore-pending 里没有 data/acme.db，放弃恢复，保留现有数据');
    fs.rmSync(pending, { recursive: true, force: true });
    return null;
  }

  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${config.dbFile}${suffix}`, { force: true });
  }
  fs.renameSync(dbInPending, config.dbFile);

  for (const [from, to] of [
    [path.join(pending, 'storage'), config.storageDir],
    [path.join(pending, 'acme.sh'), config.acmeHome],
  ] as const) {
    if (!fs.existsSync(from)) continue;
    try {
      fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(from, to);
    } catch (e) {
      console.error(`[restore] 恢复目录 ${to} 失败（可重新签发补回）：`, e);
    }
  }

  fs.rmSync(pending, { recursive: true, force: true });
  for (const name of fs.readdirSync(config.dataDir)) {
    if (name.startsWith('restore-staging-')) {
      fs.rmSync(path.join(config.dataDir, name), { recursive: true, force: true });
    }
  }
  console.log(`[restore] 已从${info.scope === 'full' ? '完整' : '仅配置'}备份恢复数据（就位时间 ${info.at}）`);
  return info;
}
