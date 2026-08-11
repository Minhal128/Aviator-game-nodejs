/**
 * Email accounts (§8.1) — the guest upgrades IN PLACE (progress survives),
 * duplicate emails are rejected with ERR_EMAIL_TAKEN, login verifies the
 * bcrypt hash and issues a fresh token pair, and wrong credentials share
 * one generic ERR_INVALID_CREDENTIALS (no account probing).
 */
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { lrUsers } from '../src/db/schema.js';
import { API_ERR, isApiError } from '../src/services/errors.js';
import { AuthService } from '../src/services/AuthService.js';
import { SettingsService } from '../src/services/SettingsService.js';
import { WalletService } from '../src/services/WalletService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

describeDb('AuthService email accounts (§8.1)', () => {
  const suite = setupDbSuite();

  function build(): AuthService {
    const db = suite.db();
    return new AuthService(db, new WalletService(db), new SettingsService(db), 'test-secret-key');
  }

  function device(): string {
    return `dev_${Math.random().toString(36).slice(2, 12)}`;
  }

  function mail(): string {
    return `p${Math.random().toString(36).slice(2, 10)}@example.com`;
  }

  it('register upgrades the guest in place — progress survives', async () => {
    const auth = build();
    const guest = await auth.guestLogin({ deviceId: device() });
    const before = await suite
      .db()
      .select({ coins: lrUsers.coins, xp: lrUsers.xp })
      .from(lrUsers)
      .where(eq(lrUsers.id, guest.user.id));

    const email = mail();
    const user = await auth.registerEmail(guest.user.id, email.toUpperCase(), 'secret-pass-1');
    expect(user.id).toBe(guest.user.id); // SAME row: pet/level/wallet intact
    expect(user.isGuest).toBe(false);
    expect(user.email).toBe(email); // normalized to lowercase
    const after = await suite
      .db()
      .select({ coins: lrUsers.coins, xp: lrUsers.xp })
      .from(lrUsers)
      .where(eq(lrUsers.id, guest.user.id));
    expect(after[0]).toEqual(before[0]);

    // Second register on the (now) account is rejected.
    await expect(auth.registerEmail(guest.user.id, mail(), 'another-pass')).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.VALIDATION),
    );
  });

  it('duplicate email rejected with ERR_EMAIL_TAKEN', async () => {
    const auth = build();
    const email = mail();
    const a = await auth.guestLogin({ deviceId: device() });
    await auth.registerEmail(a.user.id, email, 'secret-pass-1');
    const b = await auth.guestLogin({ deviceId: device() });
    await expect(auth.registerEmail(b.user.id, email, 'secret-pass-2')).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.EMAIL_TAKEN),
    );
  });

  it('login verifies the password and issues tokens; wrong creds are generic', async () => {
    const auth = build();
    const email = mail();
    const guest = await auth.guestLogin({ deviceId: device() });
    await auth.registerEmail(guest.user.id, email, 'secret-pass-1');

    const ok = await auth.loginEmail(email, 'secret-pass-1');
    expect(ok.user.id).toBe(guest.user.id);
    expect(ok.tokens.access.length).toBeGreaterThan(20);
    const verified = await auth.verifyAccess(ok.tokens.access);
    expect(verified.userId).toBe(guest.user.id);

    await expect(auth.loginEmail(email, 'wrong-password')).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.INVALID_CREDENTIALS),
    );
    await expect(auth.loginEmail(mail(), 'secret-pass-1')).rejects.toSatisfy(
      (e: unknown) => isApiError(e, API_ERR.INVALID_CREDENTIALS),
    );
  });
});
