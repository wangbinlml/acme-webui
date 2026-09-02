import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';

export function getSetting(key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).all()[0];
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getAccountEmail(): string | null {
  return getSetting('accountEmail');
}
