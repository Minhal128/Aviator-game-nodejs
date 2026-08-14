/**
 * Bridge from Ludo Node to the Turbo Legends (Laravel) wallet.
 * 1 Ludo coin = ₹1. Off unless LARAVEL_WALLET_URL + LARAVEL_WALLET_KEY are set.
 */
import { eq } from 'drizzle-orm';
import type { DbConn } from '../db/client.js';
import { lrUsers } from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';

export function siteWalletEnabled(): boolean {
  return Boolean(process.env.LARAVEL_WALLET_URL && process.env.LARAVEL_WALLET_KEY);
}

/** deviceId `tl123` → Laravel users.id 123 */
export function parseSiteUserId(deviceId: string | null | undefined): number | null {
  if (!deviceId) return null;
  const m = /^tl(\d+)$/.exec(deviceId);
  return m ? Number(m[1]) : null;
}

/**
 * Balance stamped by the Laravel /api/v1 proxy (X-TL-Wallet-Balance).
 * Avoids Node→Laravel re-entry while artisan serve is already handling the proxy.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const stampedSiteBalance = new AsyncLocalStorage<number | null>();

/** Prefer enterWith so Express async handlers keep the store. */
export function enterStampedSiteBalance(balance: number | null): void {
  stampedSiteBalance.enterWith(balance);
}

export function getStampedSiteBalance(): number | null {
  const v = stampedSiteBalance.getStore();
  return v === undefined ? null : v;
}

export async function siteUserIdFor(
  db: DbConn,
  lrUserId: number,
): Promise<number | null> {
  const rows = await db
    .select({ deviceId: lrUsers.deviceId })
    .from(lrUsers)
    .where(eq(lrUsers.id, lrUserId))
    .limit(1);
  return parseSiteUserId(rows[0]?.deviceId ?? null);
}

export class SiteWallet {
  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  static fromEnv(): SiteWallet | null {
    const url = process.env.LARAVEL_WALLET_URL?.replace(/\/$/, '');
    const key = process.env.LARAVEL_WALLET_KEY;
    if (!url || !key) return null;
    return new SiteWallet(url, key);
  }

  private async call(
    action: 'balance' | 'debit' | 'credit',
    userId: number,
    amount?: number,
    ref?: string,
  ): Promise<number> {
    const body: Record<string, unknown> = { action, userId };
    if (amount !== undefined) body.amount = amount;
    if (ref !== undefined) body.ref = ref;
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-TL-Ludo-Key': this.key,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      isSuccess?: boolean;
      message?: string;
      data?: { balance?: number };
    };
    if (!json.isSuccess || typeof json.data?.balance !== 'number') {
      if (json.message === 'Insufficient balance') {
        throw new ApiError(409, API_ERR.INSUFFICIENT_FUNDS, json.message);
      }
      throw new ApiError(502, API_ERR.INTERNAL, json.message ?? 'site wallet failed');
    }
    return json.data.balance;
  }

  balance(userId: number): Promise<number> {
    return this.call('balance', userId);
  }

  debit(userId: number, amount: number, ref: string): Promise<number> {
    return this.call('debit', userId, amount, ref);
  }

  credit(userId: number, amount: number, ref: string): Promise<number> {
    return this.call('credit', userId, amount, ref);
  }
}
