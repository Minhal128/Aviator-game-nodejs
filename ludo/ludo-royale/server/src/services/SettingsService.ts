/**
 * Read-side of lr_settings with a 60s in-process cache (ARQUITECTURA §10.1 —
 * both processes cache settings/flags; the admin edits land within a minute
 * without restarts). The whole table is one small SELECT, so the cache loads
 * it wholesale instead of per key.
 *
 * Writes go through set() (admin routes, Sprint 3b) which also invalidates
 * the local cache — other processes converge on TTL expiry.
 */
import type { Db } from '../db/client.js';
import { lrSettings } from '../db/schema.js';

type SettingRow = { value: string; type: 'string' | 'int' | 'bool' | 'json' };

export class SettingsService {
  private cache: Map<string, SettingRow> | null = null;
  private fetchedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly ttlMs = 60_000,
  ) {}

  /** Drop the cache; next read hits the DB. */
  invalidate(): void {
    this.cache = null;
    this.fetchedAt = 0;
  }

  async getString(key: string, fallback: string): Promise<string> {
    const row = await this.row(key);
    return row?.value ?? fallback;
  }

  async getInt(key: string, fallback: number): Promise<number> {
    const row = await this.row(key);
    if (!row) return fallback;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : fallback;
  }

  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.row(key);
    if (!row) return fallback;
    return row.value === '1' || row.value === 'true';
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const row = await this.row(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  /** Upsert a setting and refresh local cache immediately. */
  async set(
    key: string,
    value: string,
    type: SettingRow['type'] = 'string',
    grp = 'general',
  ): Promise<void> {
    await this.db
      .insert(lrSettings)
      .values({ key, value, type, grp, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { value, type, updatedAt: new Date() } });
    this.invalidate();
  }

  private async row(key: string): Promise<SettingRow | undefined> {
    const now = Date.now();
    if (!this.cache || now - this.fetchedAt > this.ttlMs) {
      const rows = await this.db
        .select({ key: lrSettings.key, value: lrSettings.value, type: lrSettings.type })
        .from(lrSettings);
      this.cache = new Map(rows.map((r) => [r.key, { value: r.value, type: r.type }]));
      this.fetchedAt = now;
    }
    return this.cache.get(key);
  }
}

/** Settings keys used in Sprint 3a (full seed catalog in db/seed.ts). */
export const SETTING_KEYS = {
  initialCoins: 'initial_coins',
  initialGems: 'initial_gems',
} as const;
