/**
 * SettingsService: typed getters over the seeded catalog and the 60s cache
 * contract (stale within TTL, fresh after invalidate()/set()).
 */
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { lrSettings } from '../src/db/schema.js';
import { SettingsService } from '../src/services/SettingsService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

describeDb('SettingsService (typed getters + 60s cache)', () => {
  const suite = setupDbSuite();

  it('reads seeded defaults with the right types', async () => {
    const settings = new SettingsService(suite.db());

    expect(await settings.getInt('initial_coins', 0)).toBe(5000);
    expect(await settings.getInt('initial_gems', 0)).toBe(50);
    expect(await settings.getInt('turn_timer_s', 0)).toBe(15);
    expect(await settings.getBool('rule_block_enabled', false)).toBe(true);
    expect(await settings.getString('daily_reset_tz', '')).toBe('UTC');

    const rewards = await settings.getJson<Record<string, { coins: number }>>(
      'leaderboard_rewards',
      {},
    );
    expect(rewards['1']?.coins).toBe(5000);
  });

  it('falls back for unknown keys and malformed values', async () => {
    const settings = new SettingsService(suite.db());
    expect(await settings.getInt('no_such_key', 42)).toBe(42);
    expect(await settings.getBool('no_such_key', true)).toBe(true);
    expect(await settings.getJson('daily_reset_tz', { fallback: true })).toEqual({
      fallback: true,
    }); // 'UTC' is not JSON → fallback
  });

  it('serves cached values within the TTL and fresh ones after invalidate()', async () => {
    const settings = new SettingsService(suite.db(), 60_000);

    expect(await settings.getInt('initial_coins', 0)).toBe(5000); // warm cache

    // Out-of-band admin edit (direct DB write, another process).
    await suite
      .db()
      .update(lrSettings)
      .set({ value: '9999' })
      .where(eq(lrSettings.key, 'initial_coins'));

    // Within TTL: still the cached value.
    expect(await settings.getInt('initial_coins', 0)).toBe(5000);

    settings.invalidate();
    expect(await settings.getInt('initial_coins', 0)).toBe(9999);
  });

  it('set() upserts and refreshes the local cache immediately', async () => {
    const settings = new SettingsService(suite.db());

    await settings.set('turn_timer_s', '20', 'int', 'rules');
    expect(await settings.getInt('turn_timer_s', 0)).toBe(20);

    await settings.set('brand_new_key', '{"a":1}', 'json', 'general');
    expect(await settings.getJson<{ a: number }>('brand_new_key', { a: 0 })).toEqual({ a: 1 });
  });
});
