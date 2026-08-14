/**
 * WalletService — THE single point of balance mutation for the whole product
 * (both processes). No other service touches lr_users.coins/gems directly;
 * IapService, AdRewardService, DailyBonusService, MissionService, the game
 * server's MatchService — all of them go through credit()/debit() (or the
 * *In variants inside their own transaction).
 *
 * When LARAVEL_WALLET_* is set, HUD coins come from the Turbo Legends wallet
 * (1 coin = ₹1) for deviceIds `tl{userId}`. Match entry/prize settle via
 * SiteWallet in MatchService — not through applyIn.
 *
 * Transactional contract (ARQUITECTURA §7.2, verbatim):
 *
 *   BEGIN;
 *   UPDATE lr_users SET coins = coins + :amount      -- RELATIVE, never absolute
 *     WHERE id = :user_id [AND coins >= :amount for debits];
 *   -- affected_rows = 0 → ROLLBACK + ERR_INSUFFICIENT_FUNDS
 *   SELECT coins AS balance_after ...;               -- inside the SAME tx
 *   INSERT INTO lr_wallet_transactions (..., balance_after, ...);
 *   COMMIT;
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db, DbConn, Tx } from '../db/client.js';
import { lrUsers, lrWalletTransactions, WALLET_TX_TYPES } from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';
import { parseSiteUserId, SiteWallet, siteUserIdFor, siteWalletEnabled, getStampedSiteBalance } from './SiteWallet.js';

export type WalletCurrency = 'coins' | 'gems';
export type WalletTxType = (typeof WALLET_TX_TYPES)[number];

export interface WalletMutationResult {
  /** Balance of `currency` right after this operation (ledger snapshot). */
  balanceAfter: number;
  /** lr_wallet_transactions.id of the appended entry. */
  ledgerId: number;
}

export interface LedgerPage {
  entries: Array<typeof lrWalletTransactions.$inferSelect>;
  /** Pass as `beforeId` to fetch the next (older) page; null = end. */
  nextCursor: number | null;
}

export class WalletService {
  constructor(private readonly db: Db) {}

  async credit(
    userId: number,
    currency: WalletCurrency,
    amount: number,
    type: WalletTxType,
    refType?: string,
    refId?: number,
    note?: string,
  ): Promise<WalletMutationResult> {
    WalletService.assertPositiveAmount(amount);
    return this.db.transaction((tx) =>
      this.applyIn(tx, userId, currency, amount, type, refType, refId, note),
    );
  }

  async debit(
    userId: number,
    currency: WalletCurrency,
    amount: number,
    type: WalletTxType,
    refType?: string,
    refId?: number,
    note?: string,
  ): Promise<WalletMutationResult> {
    WalletService.assertPositiveAmount(amount);
    return this.db.transaction((tx) =>
      this.applyIn(tx, userId, currency, -amount, type, refType, refId, note),
    );
  }

  async creditIn(
    tx: Tx,
    userId: number,
    currency: WalletCurrency,
    amount: number,
    type: WalletTxType,
    refType?: string,
    refId?: number,
    note?: string,
  ): Promise<WalletMutationResult> {
    WalletService.assertPositiveAmount(amount);
    return this.applyIn(tx, userId, currency, amount, type, refType, refId, note);
  }

  async debitIn(
    tx: Tx,
    userId: number,
    currency: WalletCurrency,
    amount: number,
    type: WalletTxType,
    refType?: string,
    refId?: number,
    note?: string,
  ): Promise<WalletMutationResult> {
    WalletService.assertPositiveAmount(amount);
    return this.applyIn(tx, userId, currency, -amount, type, refType, refId, note);
  }

  private static assertPositiveAmount(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ApiError(400, API_ERR.INVALID_AMOUNT, `invalid wallet amount: ${amount}`);
    }
  }

  async getBalances(userId: number, conn: DbConn = this.db): Promise<{ coins: number; gems: number }> {
    const rows = await conn
      .select({ coins: lrUsers.coins, gems: lrUsers.gems, deviceId: lrUsers.deviceId })
      .from(lrUsers)
      .where(eq(lrUsers.id, userId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new ApiError(404, API_ERR.USER_NOT_FOUND);
    const site = SiteWallet.fromEnv();
    const siteId = site ? parseSiteUserId(row.deviceId) : null;
    if (site && siteId) {
      // Prefer proxy-stamped balance. Never HTTP back to Laravel here — that
      // deadlocks php artisan serve (proxy → node → wallet → same PHP).
      const stamped = getStampedSiteBalance();
      if (stamped !== null) {
        return { coins: Math.max(0, Math.floor(stamped)), gems: row.gems };
      }
      return { coins: row.coins, gems: row.gems };
    }
    return { coins: row.coins, gems: row.gems };
  }

  async getLedger(userId: number, opts: { limit?: number; beforeId?: number } = {}): Promise<LedgerPage> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const where =
      opts.beforeId !== undefined
        ? and(eq(lrWalletTransactions.userId, userId), lt(lrWalletTransactions.id, opts.beforeId))
        : eq(lrWalletTransactions.userId, userId);
    const entries = await this.db
      .select()
      .from(lrWalletTransactions)
      .where(where)
      .orderBy(desc(lrWalletTransactions.id))
      .limit(limit + 1);
    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const last = page[page.length - 1];
    return { entries: page, nextCursor: hasMore && last ? last.id : null };
  }

  private async applyIn(
    tx: Tx,
    userId: number,
    currency: WalletCurrency,
    signedAmount: number,
    type: WalletTxType,
    refType?: string,
    refId?: number,
    note?: string,
  ): Promise<WalletMutationResult> {
    if (!Number.isSafeInteger(signedAmount) || signedAmount === 0) {
      throw new ApiError(400, API_ERR.INVALID_AMOUNT, `invalid wallet amount: ${signedAmount}`);
    }

    // Site-linked players: every coin move hits Laravel (1 coin = ₹1).
    // MatchService already settles match_entry/prize via SiteWallet; other grants
    // (wheel/daily/shop) come through here. Gems stay on lr_users.
    if (currency === 'coins' && siteWalletEnabled()) {
      const site = SiteWallet.fromEnv();
      const sid = site ? await siteUserIdFor(tx, userId) : null;
      if (site && sid) {
        if (type === 'match_entry' || type === 'match_prize') {
          throw new ApiError(
            500,
            API_ERR.INTERNAL,
            'match coin moves must go through SiteWallet (MatchService)',
          );
        }
        const magnitude = Math.abs(signedAmount);
        const ref =
          `${type}_${refType ?? 'x'}_${refId ?? 0}_${userId}_${magnitude}_${signedAmount > 0 ? 'c' : 'd'}`;
        // ponytail: HTTP outside InnoDB atomicity; idempotent refs on Laravel side
        if (signedAmount < 0) await site.debit(sid, magnitude, ref);
        else await site.credit(sid, magnitude, ref);
        const bal = Math.max(0, Math.floor(await site.balance(sid)));
        const [insertHeader] = await tx.insert(lrWalletTransactions).values({
          userId,
          currency,
          amount: signedAmount,
          balanceAfter: bal,
          type,
          refType: refType ?? null,
          refId: refId ?? null,
          note: note ?? `site:${ref}`,
          createdAt: new Date(),
        });
        return { balanceAfter: bal, ledgerId: insertHeader.insertId };
      }
    }

    const isDebit = signedAmount < 0;
    const magnitude = Math.abs(signedAmount);
    const column = currency === 'coins' ? lrUsers.coins : lrUsers.gems;

    const setClause =
      currency === 'coins'
        ? { coins: sql`${lrUsers.coins} + ${signedAmount}` }
        : { gems: sql`${lrUsers.gems} + ${signedAmount}` };
    const where = isDebit
      ? and(eq(lrUsers.id, userId), gte(column, magnitude))
      : eq(lrUsers.id, userId);
    const [updateHeader] = await tx.update(lrUsers).set(setClause).where(where);

    if (updateHeader.affectedRows === 0) {
      if (!isDebit) throw new ApiError(404, API_ERR.USER_NOT_FOUND);
      const exists = await tx
        .select({ id: lrUsers.id })
        .from(lrUsers)
        .where(eq(lrUsers.id, userId))
        .limit(1);
      if (exists.length === 0) throw new ApiError(404, API_ERR.USER_NOT_FOUND);
      throw new ApiError(
        409,
        API_ERR.INSUFFICIENT_FUNDS,
        `debit of ${magnitude} ${currency} exceeds balance`,
      );
    }

    const balanceRows = await tx
      .select({ balance: column })
      .from(lrUsers)
      .where(eq(lrUsers.id, userId))
      .limit(1);
    const balanceAfter = balanceRows[0]?.balance;
    if (balanceAfter === undefined) throw new ApiError(404, API_ERR.USER_NOT_FOUND);

    const [insertHeader] = await tx.insert(lrWalletTransactions).values({
      userId,
      currency,
      amount: signedAmount,
      balanceAfter,
      type,
      refType: refType ?? null,
      refId: refId ?? null,
      note: note ?? null,
      createdAt: new Date(),
    });

    return { balanceAfter, ledgerId: insertHeader.insertId };
  }
}
