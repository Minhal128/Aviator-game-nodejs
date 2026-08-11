/**
 * ShopService — virtual-currency catalog + purchases (ARQUITECTURA §7.5).
 *
 * Purchase contract (§7.2): debit and grant live in ONE transaction. The
 * debit goes through WalletService.debitIn (ledger 'shop_purchase', ref
 * shop_item/id — repeat purchases of the same SKU are legal, which is exactly
 * why the ledger carries NO polymorphic UNIQUE). Ownership dedupe for
 * permanent items is the lr_user_inventory UNIQUE(user_id, item_id) — a
 * duplicate rolls the debit back and surfaces ERR_ALREADY_OWNED.
 *
 * Grant matrix by item shape:
 *   grants_currency set   → currency pack: credit coins/gems, NO inventory row
 *   category 'booster'    → consumable: inventory qty stacks (+1 per buy)
 *   duration_h set        → temporal: expires_at = now + duration; re-buying
 *                           extends from the current expiry when still alive
 *   otherwise             → permanent: single row, duplicate = ALREADY_OWNED
 *
 * IAP items (`price_currency='iap'`) are NOT sold here — they arrive via the
 * §8.3 webhook (IapService, Sprint 3c).
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { lrShopItems, lrUserInventory, lrUsers } from '../db/schema.js';
import { isDuplicateKeyError } from './AuthService.js';
import { API_ERR, ApiError } from './errors.js';
import type { WalletService } from './WalletService.js';

const HOUR_MS = 60 * 60 * 1000;

export type ShopItemRow = typeof lrShopItems.$inferSelect;

export interface PurchaseResult {
  itemId: number;
  sku: string;
  category: ShopItemRow['category'];
  paid: { currency: 'coins' | 'gems'; amount: number } | null;
  granted:
    | { kind: 'currency'; currency: 'coins' | 'gems'; amount: number }
    | { kind: 'inventory'; expiresAt: Date | null };
}

export class ShopService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
  ) {}

  /** Active catalog within its availability window, shop-sorted. */
  async getCatalog(now: Date = new Date()): Promise<ShopItemRow[]> {
    const rows = await this.db
      .select()
      .from(lrShopItems)
      .where(eq(lrShopItems.isActive, true))
      .orderBy(asc(lrShopItems.category), asc(lrShopItems.sortOrder), asc(lrShopItems.id));
    return rows.filter((r) => inWindow(r, now));
  }

  /** Buy `sku` with virtual currency. One transaction: debit + grant. */
  async buy(userId: number, sku: string, now: Date = new Date()): Promise<PurchaseResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const items = await tx
          .select()
          .from(lrShopItems)
          .where(and(eq(lrShopItems.sku, sku), eq(lrShopItems.isActive, true)))
          .limit(1);
        const item = items[0];
        if (!item || !inWindow(item, now)) {
          throw new ApiError(404, API_ERR.ITEM_UNAVAILABLE, 'item is not available');
        }
        if (item.priceCurrency === 'iap') {
          throw new ApiError(400, API_ERR.VALIDATION, 'IAP items are purchased through the store (§8.3)');
        }

        const users = await tx
          .select({ level: lrUsers.level })
          .from(lrUsers)
          .where(eq(lrUsers.id, userId))
          .limit(1);
        if (!users[0]) throw new ApiError(404, API_ERR.USER_NOT_FOUND);
        if (users[0].level < item.minLevel) {
          throw new ApiError(403, API_ERR.ITEM_UNAVAILABLE, `requires level ${item.minLevel}`);
        }

        // 1) Pay (free items skip the ledger entirely).
        let paid: PurchaseResult['paid'] = null;
        if (item.priceCurrency !== 'free' && item.priceAmount > 0) {
          await this.wallet.debitIn(
            tx, userId, item.priceCurrency, item.priceAmount,
            'shop_purchase', 'shop_item', item.id,
          );
          paid = { currency: item.priceCurrency, amount: item.priceAmount };
        }

        // 2) Grant.
        if (item.grantsCurrency && (item.grantsAmount ?? 0) > 0) {
          await this.wallet.creditIn(
            tx, userId, item.grantsCurrency, item.grantsAmount!,
            'shop_purchase', 'shop_item', item.id,
          );
          return {
            itemId: item.id,
            sku: item.sku,
            category: item.category,
            paid,
            granted: { kind: 'currency', currency: item.grantsCurrency, amount: item.grantsAmount! },
          };
        }

        const temporal = item.durationH !== null;
        const consumable = item.category === 'booster';
        const expiresAt = temporal ? new Date(now.getTime() + item.durationH! * HOUR_MS) : null;
        const insert = tx.insert(lrUserInventory).values({
          userId,
          itemId: item.id,
          qty: 1,
          acquiredVia: 'shop',
          expiresAt,
          createdAt: now,
        });
        if (consumable) {
          await insert.onDuplicateKeyUpdate({ set: { qty: sql`qty + 1` } });
        } else if (temporal) {
          // Re-buying a live temporal item stacks time on top of the current
          // expiry; an expired row restarts from now.
          await insert.onDuplicateKeyUpdate({
            set: {
              expiresAt: sql`IF(expires_at IS NOT NULL AND expires_at > ${now}, DATE_ADD(expires_at, INTERVAL ${item.durationH} HOUR), ${expiresAt})`,
            },
          });
        } else {
          await insert; // permanent — a duplicate throws ER_DUP_ENTRY
        }

        return {
          itemId: item.id,
          sku: item.sku,
          category: item.category,
          paid,
          granted: { kind: 'inventory', expiresAt },
        };
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Whole tx rolled back — the debit never happened (§7.2).
        throw new ApiError(409, API_ERR.ALREADY_OWNED, 'item already owned');
      }
      throw err;
    }
  }
}

function inWindow(item: ShopItemRow, now: Date): boolean {
  if (item.availableFrom && item.availableFrom.getTime() > now.getTime()) return false;
  if (item.availableUntil && item.availableUntil.getTime() <= now.getTime()) return false;
  return true;
}
