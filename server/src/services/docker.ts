import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';

const DOCKER_SOCKET = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock';

export function dockerSocketAvailable(): boolean {
  return fs.existsSync(DOCKER_SOCKET);
}

interface DockerResponse {
  status: number;
  body: string;
}

function dockerRequest(method: string, apiPath: string, body?: unknown): Promise<DockerResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (payload !== null) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path: apiPath, method, headers, timeout: 10_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('连接 Docker API 超时')));
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

/** docker raw-stream 帧格式：1 字节流类型（1=stdout 2=stderr）+ 4 字节大端长度 + 负载 */
function parseRawStream(buf: Buffer): string {
  const headerEnd = buf.indexOf('\r\n\r\n');
  if (headerEnd < 0) return '';
  const statusLine = buf.subarray(0, headerEnd).toString('latin1').split('\r\n')[0];
  if (!/^HTTP\/1\.[01] (101|200)/.test(statusLine)) return statusLine;
  const out: Buffer[] = [];
  let pos = headerEnd + 4;
  while (pos + 8 <= buf.length) {
    const type = buf[pos];
    const size = buf.readUInt32BE(pos + 4);
    if (pos + 8 + size > buf.length) break;
    if (type === 1 || type === 2) out.push(buf.subarray(pos + 8, pos + 8 + size));
    pos += 8 + size;
  }
  return Buffer.concat(out).toString('utf8').trim();
}

/** 读取 exec 的 hijack 输出流，命令结束（连接关闭）或超时后返回已收到的输出 */
function readExecStream(execId: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ Detach: false, Tty: false });
    const socket = net.connect(DOCKER_SOCKET);
    socket.setTimeout(timeoutMs);
    const chunks: Buffer[] = [];
    socket.on('connect', () => {
      socket.write(
        `POST /exec/${execId}/start HTTP/1.1\r\n` +
          `Host: docker\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Connection: Upgrade\r\nUpgrade: tcp\r\n\r\n${body}`,
      );
    });
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(parseRawStream(Buffer.concat(chunks)));
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(parseRawStream(Buffer.concat(chunks)));
    });
    socket.on('close', () => resolve(parseRawStream(Buffer.concat(chunks))));
  });
}

export interface ExecResult {
  code: number | null;
  output: string;
}

/** 在指定容器里执行命令（通过 docker.sock 原生 Engine API，无需安装 docker CLI） */
export async function dockerExec(container: string, cmd: string, timeoutMs = 30_000): Promise<ExecResult> {
  if (!dockerSocketAvailable()) {
    throw new Error(`未找到 Docker socket（${DOCKER_SOCKET}）。若要让本工具 reload 其他容器，请在 docker-compose.yml 中挂载 /var/run/docker.sock`);
  }
  const name = container.trim();
  if (!name) throw new Error('Docker 容器名不能为空');
  if (/[/\s]/.test(name)) throw new Error('Docker 容器名格式不正确');

  const create = await dockerRequest('POST', `/containers/${encodeURIComponent(name)}/exec`, {
    Cmd: ['sh', '-c', cmd],
    AttachStdout: true,
    AttachStderr: true,
  });
  if (create.status !== 201) {
    throw new Error(`在容器 ${name} 中创建命令失败（HTTP ${create.status}）：${create.body.slice(0, 200)}`);
  }
  const execId = (JSON.parse(create.body) as { Id?: string }).Id;
  if (!execId) throw new Error('Docker API 未返回 exec Id');

  const output = await readExecStream(execId, timeoutMs);

  const deadline = Date.now() + 5_000;
  for (;;) {
    const st = await dockerRequest('GET', `/exec/${execId}/json`);
    if (st.status === 200) {
      const info = JSON.parse(st.body) as { Running?: boolean; ExitCode?: number | null };
      if (!info.Running) return { code: info.ExitCode ?? null, output };
    }
    if (Date.now() > deadline) return { code: null, output };
    await new Promise((r) => setTimeout(r, 300));
  }
}
