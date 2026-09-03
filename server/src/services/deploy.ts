import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certificates } from '../db/schema.js';
import { type Certificate, type DeployTarget, dirNameFor, filesFor, targetsOf } from './certificates.js';
import { dockerExec } from './docker.js';
import { logEvent } from './logger.js';
import { verifyOnlineCert, type OnlineVerifyResult } from './verify.js';

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

function labelOf(t: DeployTarget): string {
  return t.name.trim() || t.targetDir || t.id;
}

/** 把单个目标的执行结果写回 certificates.deployTargets JSON（读-改-写整个数组） */
function recordTargetResult(certId: number, targetId: string, ok: boolean, message: string): void {
  const row = db.select().from(certificates).where(eq(certificates.id, certId)).all()[0];
  if (!row) return;
  const targets = targetsOf(row).map((t) =>
    t.id === targetId ? { ...t, lastRunAt: new Date().toISOString(), lastError: ok ? null : message } : t,
  );
  db.update(certificates)
    .set({ deployTargets: JSON.stringify(targets), updatedAt: new Date().toISOString() })
    .where(eq(certificates.id, certId))
    .run();
}

function doneTarget(cert: Certificate, t: DeployTarget, ok: boolean, message: string): DeployResult {
  recordTargetResult(cert.id, t.id, ok, message);
  logEvent(
    ok ? 'info' : 'warn',
    `部署 ${cert.primaryDomain} → ${labelOf(t)} ${ok ? '成功' : '失败'}：${message.split('\n')[0]}`,
    cert.id,
  );
  return { ok, message };
}

/**
 * 部署成功后的线上验证：连 <主域名>:443 比对线上证书与本地文件的指纹。
 * strict=true（reload 由本工具触发）时线上不一致按失败处理；
 * strict=false（「仅复制」模式，reload 由外部负责）时只作为参考信息附加。
 */
async function finishVerified(
  cert: Certificate,
  t: DeployTarget,
  okMsg: string,
  strict: boolean,
  verifyOnce: () => Promise<OnlineVerifyResult>,
): Promise<DeployResult> {
  const v = await verifyOnce();
  if (v.status === 'pass') return doneTarget(cert, t, true, `${okMsg}\n✅ 线上验证：${v.detail}`);
  if (v.status === 'skip') return doneTarget(cert, t, true, `${okMsg}\nℹ️ ${v.detail}`);
  if (strict) {
    logEvent('warn', `部署 ${cert.primaryDomain} 后线上验证未通过：${v.detail}`, cert.id);
    return doneTarget(cert, t, false, `⚠️ 线上验证未通过：${v.detail}\n（${okMsg.split('\n')[0]}）`);
  }
  return doneTarget(cert, t, true, `${okMsg}\nℹ️ 线上验证仅供参考：${v.detail}；当前为「仅复制」模式，reload 由外部负责`);
}

/** 执行单个部署目标：复制证书文件 + 按 mode 触发 reload + 线上验证，结果回写该目标 */
async function deployOneTarget(
  cert: Certificate,
  t: DeployTarget,
  verifyOnce: () => Promise<OnlineVerifyResult>,
): Promise<DeployResult> {
  const targetDir = t.targetDir.trim();
  if (!targetDir) return doneTarget(cert, t, false, '未配置部署目标目录');
  if (!path.isAbsolute(targetDir)) return doneTarget(cert, t, false, '部署目标目录必须是绝对路径（容器内路径）');

  const srcDir = sourceDirOf(cert);
  if (!fs.existsSync(path.join(srcDir, 'fullchain.pem')) || !fs.existsSync(path.join(srcDir, 'privkey.pem'))) {
    return doneTarget(cert, t, false, `本地证书文件不存在（${srcDir}），请先签发成功`);
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
    return doneTarget(cert, t, false, `复制证书文件到 ${destDir} 失败：${errMsg(err)}`);
  }

  const mode = t.mode as DeployMode;
  if (mode === 'none') {
    return finishVerified(cert, t, `已复制证书到 ${destDir}（未配置 reload，请自行触发服务重载）`, false, verifyOnce);
  }
  if (mode === 'command') {
    const cmd = t.cmd.trim();
    if (!cmd) return doneTarget(cert, t, false, `已复制证书到 ${destDir}，但 reload 命令为空`);
    const { code, output } = await runShell(t.cmd);
    if (code !== 0) {
      return doneTarget(cert, t, false, `已复制证书到 ${destDir}，但 reload 命令失败（退出码 ${code ?? '超时'}）\n${output}`);
    }
    return finishVerified(cert, t, `已复制证书到 ${destDir}，reload 命令执行成功${output ? `\n${output}` : ''}`, true, verifyOnce);
  }
  if (mode === 'docker') {
    const container = t.container.trim();
    if (!container) return doneTarget(cert, t, false, `已复制证书到 ${destDir}，但未配置 Docker 容器名`);
    const cmd = t.cmd.trim() || 'nginx -s reload';
    try {
      const { code, output } = await dockerExec(container, cmd);
      if (code !== 0) {
        return doneTarget(
          cert,
          t,
          false,
          `已复制证书到 ${destDir}，但容器 ${container} reload 失败（退出码 ${code ?? '未知'}）\n${output}`,
        );
      }
      return finishVerified(
        cert,
        t,
        `已复制证书到 ${destDir}，容器 ${container} reload 成功${output ? `\n${output}` : ''}`,
        true,
        verifyOnce,
      );
    } catch (err) {
      return doneTarget(cert, t, false, `已复制证书到 ${destDir}，但调用 Docker 失败：${errMsg(err)}`);
    }
  }
  return doneTarget(cert, t, false, `未知的部署方式：${String(t.mode)}`);
}

/**
 * 依次执行所有已启用的部署目标（复制 + reload + 线上验证），每个目标独立记录结果，
 * 任一失败则整体失败。在签发/续期成功后自动调用，也可由「立即部署」手动触发。永不抛异常。
 */
export async function deployCert(cert: Certificate): Promise<DeployResult> {
  const enabled = targetsOf(cert).filter((t) => t.enabled);
  if (enabled.length === 0) return { ok: false, message: '未启用任何部署目标' };

  // 线上验证结果只依赖证书本身，多目标共用一次
  let cached: Promise<OnlineVerifyResult> | null = null;
  const verifyOnce = (): Promise<OnlineVerifyResult> => {
    cached ??= verifyOnlineCert(path.join(sourceDirOf(cert), 'fullchain.pem'), cert.primaryDomain);
    return cached;
  };

  const sections: string[] = [];
  let allOk = true;
  for (const t of enabled) {
    const r = await deployOneTarget(cert, t, verifyOnce);
    if (!r.ok) allOk = false;
    sections.push(`【${labelOf(t)}】\n${r.message}`);
  }

  // 汇总写到证书行，供详情页整体展示
  const message = sections.join('\n\n');
  db.update(certificates)
    .set({
      lastDeployAt: new Date().toISOString(),
      lastDeployError: allOk ? null : message,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(certificates.id, cert.id))
    .run();
  return { ok: allOk, message };
}
