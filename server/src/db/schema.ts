import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

export const distributeTargets = sqliteTable(
  'distribute_targets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    primaryDomain: text('primary_domain').notNull(),
    /** 目标服务器 IP（来自 req.ip） */
    ip: text('ip').notNull(),
    /** nginx | docker */
    reloadMode: text('reload_mode'),
    /** Docker 容器名（docker 模式时） */
    container: text('container'),
    /** 目标机上的证书目录 */
    certDir: text('cert_dir'),
    /** 首次安装时间 */
    firstSeenAt: text('first_seen_at').notNull(),
    /** 最后同步时间 */
    lastSyncAt: text('last_sync_at'),
    /** success | no_change | error */
    lastSyncStatus: text('last_sync_status'),
    lastSyncMessage: text('last_sync_message'),
    syncCount: integer('sync_count').notNull().default(0),
    /** 逗号分隔的标签（如 "生产,集群A"） */
    tags: text('tags'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    domainIpIdx: uniqueIndex('distribute_targets_domain_ip_idx').on(table.primaryDomain, table.ip),
  }),
);
