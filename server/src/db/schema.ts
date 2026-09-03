import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const certificates = sqliteTable('certificates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  primaryDomain: text('primary_domain').notNull(),
  /** JSON 数组，包含主域名与全部 SAN */
  domains: text('domains').notNull(),
  /** letsencrypt | zerossl */
  ca: text('ca').notNull().default('letsencrypt'),
  /** ec-256 | ec-384 | rsa-2048 */
  keyType: text('key_type').notNull().default('ec-256'),
  /** dns01 | http01 */
  challengeType: text('challenge_type').notNull().default('dns01'),
  dnsProviderId: integer('dns_provider_id'),
  /** issuing | valid | error */
  status: text('status').notNull().default('issuing'),
  autoRenew: integer('auto_renew', { mode: 'boolean' }).notNull().default(true),
  renewBeforeDays: integer('renew_before_days').notNull().default(30),
  certPath: text('cert_path'),
  keyPath: text('key_path'),
  issuedAt: text('issued_at'),
  expiresAt: text('expires_at'),
  lastError: text('last_error'),
  /** 签发/续期成功后自动部署：复制证书到目标目录并按 deployMode 触发 reload */
  deployEnabled: integer('deploy_enabled', { mode: 'boolean' }).notNull().default(false),
  /** 容器内绝对路径（通过 compose 卷挂载映射到宿主或目标容器） */
  deployTargetDir: text('deploy_target_dir'),
  /** none（仅复制） | command（容器内执行命令） | docker（docker exec 到指定容器） */
  deployMode: text('deploy_mode'),
  deployCmd: text('deploy_cmd'),
  deployContainer: text('deploy_container'),
  lastDeployAt: text('last_deploy_at'),
  lastDeployError: text('last_deploy_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const dnsProviders = sqliteTable('dns_providers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** cloudflare | dnspod | aliyun | huawei | godaddy | namecheap | route53 */
  type: text('type').notNull(),
  /** JSON 对象：acme.sh 需要的环境变量 */
  credentials: text('credentials').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** info | warn | error */
  level: text('level').notNull().default('info'),
  message: text('message').notNull(),
  certificateId: integer('certificate_id'),
  createdAt: text('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  /** scrypt:<saltHex>:<hashHex> */
  passwordHash: text('password_hash').notNull(),
  /** admin（全部权限） | viewer（只读） */
  role: text('role').notNull().default('admin'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});
