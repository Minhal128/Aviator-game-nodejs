/**
 * WalletService — THE single point of balance mutation for the whole product
 * (both processes). No other service touches lr_users.coins/gems directly;
 * IapService, AdRewardService, DailyBonusService, MissionService, the game
 * server's MatchService — all of them go through credit()/debit() (or the
 * *In variants inside their own transaction).
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
 *
 * FORBIDDEN: "SELECT balance → compute in app → absolute UPDATE" (lost
 * update). The InnoDB row lock taken by the relative UPDATE serializes
 * concurrent mutations from ludo-api and ludo-game with no extra locking.
 *
 * The debit guard is written `coins >= :amount` (not `coins + :amount >= 0`):
 * balances are BIGINT UNSIGNED, and unsigned arithmetic would error out of
 * range instead of failing the WHERE.
 *
 * Ledger dedupe: NOT here (no polymorphic UNIQUE — Gate 1 fix). Grant dedupe
 * belongs to the ORIGIN tables (lr_user_missions, lr_user_mail,
 * lr_iap_receipts, lr_ad_rewards), checked/inserted in the SAME transaction
 * via creditIn()/debitIn().
 */
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db, DbConn, Tx } from '../db/client.js';
import { lrUsers, lrWalletTransactions, WALLET_TX_TYPES } from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';

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

  /**
   * Credit `amount` (positive integer) of `currency` to a user inside its
   * own transaction.
   */
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

  /**
   * Debit `amount` (positive integer). Throws ApiError(ERR_INSUFFICIENT_FUNDS)
   * — and rolls back — when the guard fails.
   */
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

  /**
   * Credit variant for composition: runs inside the CALLER's transaction so
   * origin-table dedupe (UNIQUE insert) + balance mutation commit or roll
   * back together (§7.2).
   */
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

  /** Debit variant for composition (see creditIn). */
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

  /**
   * Public entrypoints take a POSITIVE integer; the sign is owned by the
   * operation (credit(-5) must never become a silent debit).
   */
  private static assertPositiveAmount(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ApiError(400, API_ERR.INVALID_AMOUNT, `invalid wallet amount: ${amount}`);
    }
  }

  /** Current balances (cheap denormalized read for HUD/profile). */
  async getBalances(userId: number, conn: DbConn = this.db): Promise<{ coins: number; gems: number }> {
    const rows = await conn
      .select({ coins: lrUsers.coins, gems: lrUsers.gems })
      .from(lrUsers)
      .where(eq(lrUsers.id, userId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new ApiError(404, API_ERR.USER_NOT_FOUND);
    return row;
  }

  /** User's own ledger, newest first, cursor-paginated by id (§8.1). */
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

  // -------------------------------------------------------------------------
  // Core: the §7.2 contract. `signedAmount` > 0 credit, < 0 debit.
  // -------------------------------------------------------------------------

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
    const isDebit = signedAmount < 0;
    const magnitude = Math.abs(signedAmount);
    const column = currency === 'coins' ? lrUsers.coins : lrUsers.gems;

    // 1) RELATIVE update with guard — the row lock serializes concurrency.
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
      // Distinguish "no such user" from "guard failed" for a precise error.
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

    // 2) Snapshot INSIDE the same tx (we hold the row lock — no torn read).
    const balanceRows = await tx
      .select({ balance: column })
      .from(lrUsers)
      .where(eq(lrUsers.id, userId))
      .limit(1);
    const balanceAfter = balanceRows[0]?.balance;
    if (balanceAfter === undefined) throw new ApiError(404, API_ERR.USER_NOT_FOUND);

    // 3) Append-only ledger entry with the snapshot.
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
