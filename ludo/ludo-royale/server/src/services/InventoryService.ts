/**
 * InventoryService — the backpack (ARQUITECTURA §7.5).
 *
 * Equip contract: ONE equipped row per shop category (dice_skin, token_skin,
 * board_theme, avatar, avatar_frame). Equipping first unequips the category,
 * then flips the target row, then mirrors avatar/frame onto
 * lr_users.avatar_key/frame_key so the room/profile reads stay denormalized
 * and cheap.
 *
 * Expiration: temporal rows carry expires_at; sweepExpired() deletes the dead
 * rows and is invoked by the hourly housekeeping interval in api.entry.ts
 * (§7.5 "cron de expiración"). [DECISIÓN] an expired equipped skin simply
 * disappears from the backpack — the client resolves missing asset keys to
 * the defaults, so lr_users.avatar_key is NOT rewritten by the sweep (the
 * §7.14 retention crons will join the same scheduler in Sprint 3c).
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { BATTLE_POWERS } from '@ludo/shared';
import type { PowerType } from '@ludo/shared';
import type { Db, DbConn } from '../db/client.js';
import { lrShopItems, lrUserInventory, lrUsers } from '../db/schema.js';
import { API_ERR, ApiError } from './errors.js';

/** sku convention for consumable powers: `power_<PowerType>`. */
const POWER_SKU_PREFIX = 'power_';

function powerFromSku(sku: string): PowerType | null {
  if (!sku.startsWith(POWER_SKU_PREFIX)) return null;
  const power = sku.slice(POWER_SKU_PREFIX.length) as PowerType;
  // Hybrid economy: only the BATTLE set lives in the inventory — a legacy
  // classic-power row (early catalog) never seeds match charges.
  return BATTLE_POWERS.has(power) ? power : null;
}

/** Categories where "equipped" makes sense (one active per category). */
const EQUIPPABLE = ['dice_skin', 'token_skin', 'bubble_skin', 'board_theme', 'avatar', 'avatar_frame'] as const;
type EquippableCategory = (typeof EQUIPPABLE)[number];

export interface InventoryEntry {
  id: number;
  itemId: number;
  sku: string;
  category: typeof lrShopItems.$inferSelect.category;
  nameKey: string;
  assetKey: string | null;
  qty: number;
  isEquipped: boolean;
  expiresAt: Date | null;
  acquiredVia: typeof lrUserInventory.$inferSelect.acquiredVia;
}

export class InventoryService {
  constructor(private readonly db: Db) {}

  /** Backpack: live (non-expired) rows joined with their catalog item. */
  async getInventory(userId: number, now: Date = new Date()): Promise<InventoryEntry[]> {
    return this.db
      .select({
        id: lrUserInventory.id,
        itemId: lrUserInventory.itemId,
        sku: lrShopItems.sku,
        category: lrShopItems.category,
        nameKey: lrShopItems.nameKey,
        assetKey: lrShopItems.assetKey,
        qty: lrUserInventory.qty,
        isEquipped: lrUserInventory.isEquipped,
        expiresAt: lrUserInventory.expiresAt,
        acquiredVia: lrUserInventory.acquiredVia,
      })
      .from(lrUserInventory)
      .innerJoin(lrShopItems, eq(lrUserInventory.itemId, lrShopItems.id))
      .where(
        and(
          eq(lrUserInventory.userId, userId),
          or(isNull(lrUserInventory.expiresAt), gt(lrUserInventory.expiresAt, now)),
        ),
      )
      .orderBy(asc(lrShopItems.category), asc(lrShopItems.sortOrder), asc(lrUserInventory.id));
  }

  /** Equip an owned, non-expired item; unequips the rest of its category. */
  async equip(userId: number, itemId: number, now: Date = new Date()): Promise<InventoryEntry> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          invId: lrUserInventory.id,
          expiresAt: lrUserInventory.expiresAt,
          category: lrShopItems.category,
          assetKey: lrShopItems.assetKey,
          sku: lrShopItems.sku,
        })
        .from(lrUserInventory)
        .innerJoin(lrShopItems, eq(lrUserInventory.itemId, lrShopItems.id))
        .where(and(eq(lrUserInventory.userId, userId), eq(lrUserInventory.itemId, itemId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new ApiError(404, API_ERR.NOT_FOUND, 'item not in inventory');
      if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
        throw new ApiError(409, API_ERR.ITEM_EXPIRED, 'item has expired');
      }
      if (!(EQUIPPABLE as readonly string[]).includes(row.category)) {
        throw new ApiError(400, API_ERR.VALIDATION, `${row.category} items cannot be equipped`);
      }
      const category = row.category as EquippableCategory;

      // One equipped per category: clear the category, then set the target.
      await tx
        .update(lrUserInventory)
        .set({ isEquipped: false })
        .where(
          and(
            eq(lrUserInventory.userId, userId),
            eq(lrUserInventory.isEquipped, true),
            inArray(
              lrUserInventory.itemId,
              tx
                .select({ id: lrShopItems.id })
                .from(lrShopItems)
                .where(eq(lrShopItems.category, category)),
            ),
          ),
        );
      await tx
        .update(lrUserInventory)
        .set({ isEquipped: true })
        .where(eq(lrUserInventory.id, row.invId));

      // Mirror onto the denormalized profile columns (§7.5).
      const visualKey = (row.assetKey ?? row.sku).slice(0, 40);
      if (category === 'avatar') {
        await tx
          .update(lrUsers)
          .set({ avatarKey: visualKey, updatedAt: now })
          .where(eq(lrUsers.id, userId));
      } else if (category === 'avatar_frame') {
        await tx
          .update(lrUsers)
          .set({ frameKey: visualKey, updatedAt: now })
          .where(eq(lrUsers.id, userId));
      }

      const inventory = await this.getInventoryIn(tx, userId, row.invId);
      if (!inventory) throw new ApiError(500, API_ERR.INTERNAL, 'inventory row vanished');
      return inventory;
    });
  }

  /**
   * Clear the equipped item of one category — "equip the default". The
   * client's built-in defaults (classic die, base board…) are not inventory
   * rows, so switching back to them is an unequip, not an equip. Mirrored
   * profile columns (avatar/frame) reset to their column DEFAULT.
   */
  async unequip(
    userId: number,
    category: string,
    now: Date = new Date(),
  ): Promise<{ cleared: number }> {
    if (!(EQUIPPABLE as readonly string[]).includes(category)) {
      throw new ApiError(400, API_ERR.VALIDATION, `${category} items cannot be unequipped`);
    }
    const cat = category as EquippableCategory;
    return this.db.transaction(async (tx) => {
      const [header] = await tx
        .update(lrUserInventory)
        .set({ isEquipped: false })
        .where(
          and(
            eq(lrUserInventory.userId, userId),
            eq(lrUserInventory.isEquipped, true),
            inArray(
              lrUserInventory.itemId,
              tx
                .select({ id: lrShopItems.id })
                .from(lrShopItems)
                .where(eq(lrShopItems.category, cat)),
            ),
          ),
        );
      if (cat === 'avatar') {
        await tx
          .update(lrUsers)
          .set({ avatarKey: sql`DEFAULT(avatar_key)`, updatedAt: now })
          .where(eq(lrUsers.id, userId));
      } else if (cat === 'avatar_frame') {
        await tx
          .update(lrUsers)
          .set({ frameKey: sql`DEFAULT(frame_key)`, updatedAt: now })
          .where(eq(lrUsers.id, userId));
      }
      return { cleared: header.affectedRows };
    });
  }

  /**
   * POWER shop model: the player's owned power quantities (booster rows with
   * a `power_*` sku). The match seeds its per-seat charges from this.
   */
  async getPowerLoadout(
    userId: number,
    now: Date = new Date(),
  ): Promise<Partial<Record<PowerType, number>>> {
    const rows = await this.db
      .select({ sku: lrShopItems.sku, qty: lrUserInventory.qty })
      .from(lrUserInventory)
      .innerJoin(lrShopItems, eq(lrUserInventory.itemId, lrShopItems.id))
      .where(
        and(
          eq(lrUserInventory.userId, userId),
          eq(lrShopItems.category, 'booster'),
          or(isNull(lrUserInventory.expiresAt), gt(lrUserInventory.expiresAt, now)),
        ),
      );
    const loadout: Partial<Record<PowerType, number>> = {};
    for (const r of rows) {
      const power = powerFromSku(r.sku);
      if (power) loadout[power] = (loadout[power] ?? 0) + r.qty;
    }
    return loadout;
  }

  /**
   * Same, for a set of guest DEVICES at once (the Colyseus room only knows
   * deviceIds until MatchService resolves seats). Also returns the userId so
   * the room can consume on USE_POWER without another lookup.
   */
  async getPowerLoadoutsByDevice(
    deviceIds: string[],
    now: Date = new Date(),
  ): Promise<Map<string, { userId: number; loadout: Partial<Record<PowerType, number>> }>> {
    const out = new Map<string, { userId: number; loadout: Partial<Record<PowerType, number>> }>();
    if (deviceIds.length === 0) return out;
    const rows = await this.db
      .select({
        deviceId: lrUsers.deviceId,
        userId: lrUsers.id,
        sku: lrShopItems.sku,
        qty: lrUserInventory.qty,
      })
      .from(lrUserInventory)
      .innerJoin(lrShopItems, eq(lrUserInventory.itemId, lrShopItems.id))
      .innerJoin(lrUsers, eq(lrUserInventory.userId, lrUsers.id))
      .where(
        and(
          inArray(lrUsers.deviceId, deviceIds),
          eq(lrShopItems.category, 'booster'),
          or(isNull(lrUserInventory.expiresAt), gt(lrUserInventory.expiresAt, now)),
        ),
      );
    for (const r of rows) {
      if (r.deviceId === null) continue;
      const power = powerFromSku(r.sku);
      if (!power) continue;
      const entry = out.get(r.deviceId) ?? { userId: r.userId, loadout: {} };
      entry.loadout[power] = (entry.loadout[power] ?? 0) + r.qty;
      out.set(r.deviceId, entry);
    }
    return out;
  }

  /**
   * Spend ONE owned unit of a power (a successful USE_POWER). Atomic:
   * `qty = qty - 1 WHERE qty > 0` — a parallel match cannot double-spend the
   * last unit. Empty stacks are deleted so the backpack stays clean.
   */
  async consumePower(
    userId: number,
    power: PowerType,
  ): Promise<{ consumed: boolean; qtyLeft: number }> {
    const items = await this.db
      .select({ id: lrShopItems.id })
      .from(lrShopItems)
      .where(eq(lrShopItems.sku, `${POWER_SKU_PREFIX}${power}`))
      .limit(1);
    const item = items[0];
    if (!item) return { consumed: false, qtyLeft: 0 };
    const [header] = await this.db
      .update(lrUserInventory)
      .set({ qty: sql`qty - 1` })
      .where(
        and(
          eq(lrUserInventory.userId, userId),
          eq(lrUserInventory.itemId, item.id),
          gt(lrUserInventory.qty, 0),
        ),
      );
    if (header.affectedRows === 0) return { consumed: false, qtyLeft: 0 };
    await this.db
      .delete(lrUserInventory)
      .where(
        and(
          eq(lrUserInventory.userId, userId),
          eq(lrUserInventory.itemId, item.id),
          lte(lrUserInventory.qty, 0),
        ),
      );
    const rows = await this.db
      .select({ qty: lrUserInventory.qty })
      .from(lrUserInventory)
      .where(and(eq(lrUserInventory.userId, userId), eq(lrUserInventory.itemId, item.id)))
      .limit(1);
    return { consumed: true, qtyLeft: rows[0]?.qty ?? 0 };
  }

  /** Delete expired rows. Returns how many were swept (hourly cron). */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const [header] = await this.db
      .delete(lrUserInventory)
      .where(
        and(isNotNull(lrUserInventory.expiresAt), lte(lrUserInventory.expiresAt, now)),
      );
    return header.affectedRows;
  }

  private async getInventoryIn(
    conn: DbConn,
    userId: number,
    invId: number,
  ): Promise<InventoryEntry | undefined> {
    const rows = await conn
      .select({
        id: lrUserInventory.id,
        itemId: lrUserInventory.itemId,
        sku: lrShopItems.sku,
        category: lrShopItems.category,
        nameKey: lrShopItems.nameKey,
        assetKey: lrShopItems.assetKey,
        qty: lrUserInventory.qty,
        isEquipped: lrUserInventory.isEquipped,
        expiresAt: lrUserInventory.expiresAt,
        acquiredVia: lrUserInventory.acquiredVia,
      })
      .from(lrUserInventory)
      .innerJoin(lrShopItems, eq(lrUserInventory.itemId, lrShopItems.id))
      .where(and(eq(lrUserInventory.userId, userId), eq(lrUserInventory.id, invId)))
      .limit(1);
    return rows[0];
  }
}
