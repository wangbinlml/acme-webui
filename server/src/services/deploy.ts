import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates } from '../db/schema.js';
import { type Certificate, dirNameFor, filesFor } from './certificates.js';
import { dockerExec } from './docker.js';
import { logEvent } from './logger.js';

export interface DeployResult {
  ok: boolean;
  message: string;
}

const RELOAD_MODES = ['none', 'command', 'docker'] as const;
export type DeployMode = (typeof RELOAD_MODES)[number];

const FILE_NAMES = ['fullchain.pem', 'privkey.pem', 'cert.pem', 'chain.pem'] as const;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tailOf(text: string, limit = 2000): string {
  return text.length > limit ? `…${text.slice(-limit)}` : text;
}

function sourceDirOf(cert: Certificate): string {
  // 优先用数据库记录的路径（兼容旧版数字目录），否则用域名目录
  return path.dirname(cert.certPath ?? filesFor(cert).fullchain);
}

function runShell(cmd: string, timeoutMs = 30_000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      const output = tailOf(`${stdout ?? ''}${stderr ?? ''}`.trim());
      if (err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number') {
        resolve({ code: (err as NodeJS.ErrnoException & { code: number }).code, output });
      } else if (err) {
        resolve({ code: null, output: output || err.message });
      } else {
        resolve({ code: 0, output });
      }
    });
  });
}

function finish(cert: Certificate, ok: boolean, message: string): DeployResult {
  db.update(certificates)
    .set({
      lastDeployAt: new Date().toISOString(),
      lastDeployError: ok ? null : message,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(certificates.id, cert.id))
    .run();
  logEvent(ok ? 'info' : 'warn', `部署 ${cert.primaryDomain} ${ok ? '成功' : '失败'}：${message.split('\n')[0]}`, cert.id);
  return { ok, message };
}

/**
 * 把证书复制到 <deployTargetDir>/<主域名>/，然后按 deployMode 触发 reload。
 * 在签发/续期成功后自动调用，也可由「立即部署」手动触发。永不抛异常。
 */
export async function deployCert(cert: Certificate): Promise<DeployResult> {
  if (!cert.deployEnabled) return { ok: false, message: '未启用自动部署' };
  const targetDir = (cert.deployTargetDir ?? '').trim();
  if (!targetDir) return finish(cert, false, '未配置部署目标目录');
  if (!path.isAbsolute(targetDir)) return finish(cert, false, '部署目标目录必须是绝对路径（容器内路径）');

  const srcDir = sourceDirOf(cert);
  if (!fs.existsSync(path.join(srcDir, 'fullchain.pem')) || !fs.existsSync(path.join(srcDir, 'privkey.pem'))) {
    return finish(cert, false, `本地证书文件不存在（${srcDir}），请先签发成功`);
  }

  const destDir = path.join(targetDir, dirNameFor(cert.primaryDomain));
  try {
    fs.mkdirSync(destDir, { recursive: true });
    for (const name of FILE_NAMES) {
      const src = path.join(srcDir, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, name));
    }
    fs.chmodSync(path.join(destDir, 'privkey.pem'), 0o600);
  } catch (err) {
    return finish(cert, false, `复制证书文件到 ${destDir} 失败：${errMsg(err)}`);
  }

  const mode = (cert.deployMode ?? 'none') as DeployMode;
  if (mode === 'none') {
    return finish(cert, true, `已复制证书到 ${destDir}（未配置 reload，请自行触发服务重载）`);
  }
  if (mode === 'command') {
    const cmd = (cert.deployCmd ?? '').trim();
    if (!cmd) return finish(cert, false, `已复制证书到 ${destDir}，但 reload 命令为空`);
    const { code, output } = await runShell(cert.deployCmd ?? '');
    if (code === 0) return finish(cert, true, `已复制证书到 ${destDir}，reload 命令执行成功${output ? `\n${output}` : ''}`);
    return finish(cert, false, `已复制证书到 ${destDir}，但 reload 命令失败（退出码 ${code ?? '超时'}）\n${output}`);
  }
  if (mode === 'docker') {
    const container = (cert.deployContainer ?? '').trim();
    if (!container) return finish(cert, false, `已复制证书到 ${destDir}，但未配置 Docker 容器名`);
    const cmd = (cert.deployCmd ?? '').trim() || 'nginx -s reload';
    try {
      const { code, output } = await dockerExec(container, cmd);
      if (code === 0) {
        return finish(cert, true, `已复制证书到 ${destDir}，容器 ${container} reload 成功${output ? `\n${output}` : ''}`);
      }
      return finish(cert, false, `已复制证书到 ${destDir}，但容器 ${container} reload 失败（退出码 ${code ?? '未知'}）\n${output}`);
    } catch (err) {
      return finish(cert, false, `已复制证书到 ${destDir}，但调用 Docker 失败：${errMsg(err)}`);
    }
  }
  return finish(cert, false, `未知的部署方式：${String(cert.deployMode)}`);
}
