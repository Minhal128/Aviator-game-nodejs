/**
 * Guest-first auth over the REAL HTTP surface (Express app on an ephemeral
 * port + real MySQL): guest create/recover, starter grant through the
 * ledger, JWT-guarded profile, refresh rotation, token-family reuse
 * detection, logout and the auth rate-limit buckets.
 */
import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import { lrUserSessions, lrWalletTransactions } from '../src/db/schema.js';
import { describeDb, getJson, postJson, setupDbSuite, startApp, type RunningApp } from './apiHelpers.js';

describeDb('Auth API (§8.2 guest-first + refresh rotation)', () => {
  const suite = setupDbSuite();

  let running: RunningApp | null = null;
  afterEach(async () => {
    await running?.close();
    running = null;
  });

  async function boot(overrides: Parameters<typeof startApp>[1] = {}): Promise<RunningApp> {
    running = await startApp(suite.db(), overrides);
    return running;
  }

  const DEVICE = 'device-vitest-0001';

  it('POST /auth/guest creates a user with starter coins/gems and returns a token pair', async () => {
    const { baseUrl } = await boot();

    const res = await postJson(baseUrl, '/api/v1/auth/guest', { deviceId: DEVICE, name: 'Josu3' });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(typeof res.body.access).toBe('string');
    expect(typeof res.body.refresh).toBe('string');
    expect(res.body.expiresIn).toBe(900);

    const user = res.body.user as Record<string, unknown>;
    expect(user.username).toBe('Josu3');
    expect(user.isGuest).toBe(true);
    // Seeded settings: initial_coins 5000 / initial_gems 50.
    expect(user.coins).toBe(5000);
    expect(user.gems).toBe(50);
    expect(user.level).toBe(1);

    // The starter grant lives in the ledger (audit invariant §7.2).
    const ledger = await suite
      .db()
      .select()
      .from(lrWalletTransactions)
      .where(eq(lrWalletTransactions.userId, user.id as number));
    expect(ledger).toHaveLength(2);
    expect(ledger.every((row) => row.type === 'signup_bonus')).toBe(true);
  });

  it('same deviceId recovers the SAME user without a second starter grant', async () => {
    const { baseUrl } = await boot();

    const first = await postJson(baseUrl, '/api/v1/auth/guest', { deviceId: DEVICE });
    const second = await postJson(baseUrl, '/api/v1/auth/guest', { deviceId: DEVICE });

    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect((second.body.user as Record<string, unknown>).id).toBe(
      (first.body.user as Record<string, unknown>).id,
    );
    expect((second.body.user as Record<string, unknown>).coins).toBe(5000);
  });

  it('invalid display name falls back to a Player_xxxxx username', async () => {
    const { baseUrl } = await boot();

    const res = await postJson(baseUrl, '/api/v1/auth/guest', {
      deviceId: DEVICE,
      name: 'xx', // too short for the §9.7 whitelist
    });

    expect(res.status).toBe(201);
    expect((res.body.user as Record<string, unknown>).username).toMatch(/^Player_[a-z2-9]{5}$/);
  });

  it('rejects malformed deviceId with 400 ERR_VALIDATION', async () => {
    const { baseUrl } = await boot();
    const res = await postJson(baseUrl, '/api/v1/auth/guest', { deviceId: 'nope!' });
    expect(res.status).toBe(400);
    expect((res.body.error as Record<string, unknown>).code).toBe('ERR_VALIDATION');
  });

  it('GET /profile with a valid access token returns user + wallet + xp/level', async () => {
    const { baseUrl } = await boot();
    const login = await postJson(baseUrl, '/api/v1/auth/guest', { deviceId: DEVICE });

    const res = await getJson(baseUrl, '/api/v1/profile', login.body.access as string);

    expect(res.status).toBe(200);
    const wallet = res.body.wallet as Record<string, unknown>;
    const xp = res.body.xp as Record<string, unknown>;
    expect(wallet.coins).toBe(5000);
    expect(wallet.gems).toBe(50);
    expect(xp.level).toBe(1);
    expect(xp.current).toBe(0);
    // Seeded curve: level 2 at 100 XP.
    expect(xp.nextLevelAt).toBe(100);
  });

  it('GET /profile without/with a garbage token → 401 ERR_INVALID_TOKEN', async () => {
    const { baseUrl } = await boot();

    const missing = await getJson(baseUrl, '/api/v1/profile');
    expect(missing.status).toBe(401);

    const garbage = await getJson(baseUrl, '/api/v1/profile', 'not-a-jwt');
    expect(garbage.status).toBe(401);
    expect((garbage.body.error as Record<string, unknown>).code).toBe('ERR_INVALID_TOKEN');
  });

  it('refresh rotates: new pair works, and the OLD refresh reused → family revoked', async () => {
    const { baseUrl } = await boot();
    const login = await postJson(baseUrl, '/api/v1/auth/guest', { deviceId: DEVICE });
    const oldRefresh = login.body.refresh as string;

    // Legit rotation.
    const rotated = await postJson(baseUrl, '/api/v1/auth/refresh', { refresh: oldRefresh });
    expect(rotated.status).toBe(200);
    const newRefresh = rotated.body.refresh as string;
    expect(newRefresh).not.toBe(oldRefresh);

    // New access token is live.
    const profile = await getJson(baseUrl, '/api/v1/profile', rotated.body.access as string);
    expect(profile.status).toBe(200);

    // REUSE of the rotated token: theft signal.
    const reuse = await postJson(baseUrl, '/api/v1/auth/refresh', { refresh: oldRefresh });
    expect(reuse.status).toBe(401);
    expect((reuse.body.error as Record<string, unknown>).code).toBe('ERR_REFRESH_REUSED');

    // The WHOLE family died — the newest refresh is dead too.
    const afterReuse = await postJson(baseUrl, '/api/v1/auth/refresh', { refresh: newRefresh });
    expect(afterReuse.status).toBe(401);

    // Every session row of the family is revoked in the DB.
    const sessions = await suite.db().select().from(lrUserSessions);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('refresh with an unknown token → 401 ERR_INVALID_REFRESH', async () => {
    const { baseUrl } = await boot();
    const res = await postJson(baseUrl, '/api/v1/auth/refresh', {
      refresh: 'A'.repeat(43),
    });
    expect(res.status).toBe(401);
    expect((res.body.error as Record<string, unknown>).code).toBe('ERR_INVALID_REFRESH');
  });

  it('logout revokes only that session; its refresh stops working', async () => {
    const { baseUrl } = await boot();
    const login = await postJson(baseUrl, '/api/v1/auth/guest', { deviceId: DEVICE });
    const refresh = login.body.refresh as string;

    const out = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    });
    expect(out.status).toBe(204);

    const res = await postJson(baseUrl, '/api/v1/auth/refresh', { refresh });
    expect(res.status).toBe(401);
  });

  it('rate limit: guest bucket answers 429 ERR_RATE_LIMIT beyond the cap', async () => {
    const { baseUrl } = await boot({ rateLimits: { guestPerHour: 3 } });

    for (let i = 0; i < 3; i++) {
      const ok = await postJson(baseUrl, '/api/v1/auth/guest', { deviceId: `device-rl-${i}00` });
      expect(ok.status).toBe(201);
    }
    const blocked = await postJson(baseUrl, '/api/v1/auth/guest', { deviceId: 'device-rl-x00' });
    expect(blocked.status).toBe(429);
    expect((blocked.body.error as Record<string, unknown>).code).toBe('ERR_RATE_LIMIT');
  });

  it('GET /api/health reports db connectivity', async () => {
    const { baseUrl } = await boot();
    const res = await getJson(baseUrl, '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe(true);
  });
});
