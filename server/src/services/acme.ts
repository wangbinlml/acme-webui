import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { config } from '../config.js';
import { pushLive } from './logger.js';

export interface AcmeRunOptions {
  /** 传递给 acme.sh 的环境变量（DNS Provider 凭据等） */
  env?: Record<string, string>;
  certificateId?: number | null;
  /** 实时日志行的前缀（一般是主域名） */
  label?: string;
}

export interface AcmeRunResult {
  code: number;
  output: string;
}

export function acmeAvailable(): boolean {
  return fs.existsSync(config.acmeBin);
}

/**
 * 执行 acme.sh 并把输出逐行推送到实时日志流。
 * 永不抛出未捕获异常：找不到 acme.sh、进程错误都会以 rejected promise 返回。
 */
export function runAcme(args: string[], opts: AcmeRunOptions = {}): Promise<AcmeRunResult> {
  return new Promise((resolve, reject) => {
    if (!acmeAvailable()) {
      reject(
        new Error(
          `未找到 acme.sh（${config.acmeBin}）。Docker 部署时会在容器启动时自动安装；` +
            '本地开发请先安装 acme.sh，或通过 ACME_BIN 环境变量指定路径。',
        ),
      );
      return;
    }

    const child = spawn(config.acmeBin, args, {
      env: { ...process.env, ...(opts.env ?? {}) },
      cwd: config.acmeHome,
    });

    let output = '';
    const handleChunk = (chunk: string): void => {
      output += chunk;
      const lines = chunk.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = opts.label ? `${opts.label} | ${line}` : line;
        pushLive({ level: 'info', source: 'acme', message, certificateId: opts.certificateId ?? null });
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', handleChunk);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', handleChunk);

    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
}

/** 从 acme.sh 输出中提取最后几行作为错误摘要 */
export function tailOfOutput(output: string, lines = 15, maxChars = 3000): string {
  const trimmed = output
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .slice(-lines)
    .join('\n');
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}
