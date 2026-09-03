import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string[];
}

interface Reply {
  code: number;
  lines: string[];
}

const CONNECT_TIMEOUT = 10_000;
const REPLY_TIMEOUT = 15_000;

/** 极简 SMTP 客户端：支持隐式 TLS(465)、STARTTLS(587/25)、AUTH LOGIN/PLAIN，不引入第三方依赖 */
class SmtpClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = '';
  private replyLines: string[] = [];
  private waiter: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
  private replyTimer: NodeJS.Timeout | null = null;

  connect(cfg: SmtpConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (err?: Error) => {
        if (err) {
          this.destroy();
          reject(err);
        } else {
          resolve();
        }
      };
      const onError = (err: Error): void => {
        finish(new Error(`连接 SMTP 服务器失败（${cfg.host}:${cfg.port}）：${err.message}`));
      };
      const onConnect = (): void => {
        // 连接建立后必须先等服务器 220 问候语，否则它会被误读成第一条命令的应答
        this.waitReply()
          .then((reply) => {
            if (reply.code !== 220) {
              throw new Error(`SMTP 服务器问候异常：${reply.lines.join(' / ').slice(0, 200)}`);
            }
          })
          .then(() => finish(), finish);
      };
      const sock: net.Socket | tls.TLSSocket =
        cfg.port === 465
          ? // 内网中继常用自签证书，通知邮件内容不含敏感信息，这里不做证书校验
            tls.connect({ host: cfg.host, port: cfg.port, rejectUnauthorized: false }, onConnect)
          : net.connect({ host: cfg.host, port: cfg.port }, onConnect);
      sock.once('error', onError);
      sock.once('timeout', () => onError(new Error('连接超时')));
      sock.setTimeout(CONNECT_TIMEOUT);
      this.socket = sock;
      sock.on('data', (c: Buffer) => this.onData(c));
      sock.once('close', () => {
        if (this.waiter) this.settleWaiter(new Error('连接被服务器关闭'));
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl = this.buffer.indexOf('\r\n');
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 2);
      this.replyLines.push(line);
      if (/^\d{3} /.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines: this.replyLines };
        this.replyLines = [];
        this.settleWaiter(null, reply);
      }
      nl = this.buffer.indexOf('\r\n');
    }
  }

  private settleWaiter(err: Error | null, reply?: Reply): void {
    if (this.replyTimer) clearTimeout(this.replyTimer);
    const w = this.waiter;
    this.waiter = null;
    if (!w) return;
    if (err) w.reject(err);
    else if (reply) w.resolve(reply);
  }

  private waitReply(): Promise<Reply> {
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
      this.replyTimer = setTimeout(() => {
        this.destroy();
        reject(new Error('等待 SMTP 响应超时'));
      }, REPLY_TIMEOUT);
    });
  }

  /** 发送一条命令并等待应答；code >= 400（4xx/5xx）视为失败抛错 */
  async command(cmd: string): Promise<Reply> {
    if (!this.socket) throw new Error('SMTP 连接已关闭');
    const wait = this.waitReply();
    this.socket.write(`${cmd}\r\n`);
    const reply = await wait;
    if (reply.code >= 400) {
      throw new Error(`SMTP 命令失败（${cmd.split(' ')[0]}）：${reply.lines.join(' / ').slice(0, 300)}`);
    }
    return reply;
  }

  /** 明文连接升级为 TLS（STARTTLS 后调用） */
  async upgradeTls(host: string): Promise<void> {
    const old = this.socket;
    if (!old) throw new Error('SMTP 连接已关闭');
    old.removeAllListeners('data');
    old.removeAllListeners('close');
    const tlsSock = tls.connect(
      { socket: old, servername: host, rejectUnauthorized: false },
      () => {
        this.buffer = '';
      },
    );
    tlsSock.on('data', (c: Buffer) => this.onData(c));
    tlsSock.once('close', () => {
      if (this.waiter) this.settleWaiter(new Error('连接被服务器关闭'));
    });
    tlsSock.once('error', () => this.destroy());
    this.socket = tlsSock;
    await new Promise<void>((resolve, reject) => {
      if (tlsSock.encrypted) return resolve();
      tlsSock.once('secureConnect', () => resolve());
      tlsSock.once('error', (e) => reject(new Error(`TLS 握手失败：${e.message}`)));
    });
  }

  /** DATA 阶段：写入整封信并结束 */
  async writeMail(from: string, to: string[], subject: string, body: string): Promise<void> {
    if (!this.socket) throw new Error('SMTP 连接已关闭');
    const wait = this.waitReply();
    const headers = [
      `From: ${from}`,
      `To: ${to.join(', ')}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomBytes(12).toString('hex')}@acme-manager>`,
    ].join('\r\n');
    // 正文为 base64（不会出现行首 '.'），无需 dot-stuffing
    const b64 = Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    this.socket.write(`${headers}\r\n\r\n${b64}\r\n.\r\n`);
    const reply = await wait;
    if (reply.code >= 400) throw new Error(`发送邮件被拒绝：${reply.lines.join(' / ').slice(0, 300)}`);
  }

  destroy(): void {
    if (this.replyTimer) clearTimeout(this.replyTimer);
    this.socket?.destroy();
    this.socket = null;
  }
}

/** 发送一封纯文本邮件；失败抛出携带服务器应答的错误 */
export async function sendMail(cfg: SmtpConfig, subject: string, body: string): Promise<void> {
  const client = new SmtpClient();
  try {
    await client.connect(cfg);
    let ehlo = await client.command('EHLO acme-manager');
    if (cfg.port !== 465 && ehlo.lines.some((l) => /starttls/i.test(l))) {
      const st = await client.command('STARTTLS');
      if (st.code !== 220) throw new Error(`STARTTLS 被拒绝：${st.lines.join(' / ')}`);
      await client.upgradeTls(cfg.host);
      ehlo = await client.command('EHLO acme-manager');
    }
    if (cfg.user) {
      // EHLO 的每一行都带 3 位状态码前缀（如 "250 AUTH LOGIN PLAIN"）
      const caps = ehlo.lines.find((l) => /^\d{3}[ -]AUTH\b/i.test(l)) ?? '';
      if (/plain/i.test(caps)) {
        const token = Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64');
        await client.command(`AUTH PLAIN ${token}`);
      } else {
        await client.command('AUTH LOGIN');
        await client.command(Buffer.from(cfg.user, 'utf8').toString('base64'));
        await client.command(Buffer.from(cfg.pass, 'utf8').toString('base64'));
      }
    }
    await client.command(`MAIL FROM:<${cfg.from}>`);
    for (const t of cfg.to) await client.command(`RCPT TO:<${t}>`);
    await client.command('DATA');
    await client.writeMail(cfg.from, cfg.to, subject, body);
    await client.command('QUIT');
  } finally {
    client.destroy();
  }
}
