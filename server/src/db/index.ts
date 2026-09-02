import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const sqlite = new Database(config.dbFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// dist/db/index.js -> ../../drizzle，开发时 src/db/index.ts 同样指向 server/drizzle
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function runMigrations(): void {
  migrate(db, { migrationsFolder });
}
