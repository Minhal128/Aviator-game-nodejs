/**
 * ShopService + InventoryService against REAL MySQL: the one-transaction
 * buy (debit + grant), permanent-duplicate rejection with FULL rollback,
 * temporal expiration, single-equip per category and sweepExpired().
 */
import { and, eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { lrShopItems, lrUserInventory, lrUsers } from '../src/db/schema.js';
import { API_ERR, isApiError } from '../src/services/errors.js';
import { InventoryService } from '../src/services/InventoryService.js';
import { ShopService } from '../src/services/ShopService.js';
import { WalletService } from '../src/services/WalletService.js';
import { describeDb, setupDbSuite } from './apiHelpers.js';

const HOUR_MS = 60 * 60 * 1000;

describeDb('ShopService + InventoryService (§7.5)', () => {
  const suite = setupDbSuite();

  function build() {
    const db = suite.db();
    const wallet = new WalletService(db);
    return { db, wallet, shop: new ShopService(db, wallet), inventory: new InventoryService(db) };
  }

  async function createUser(coins = 10_000, gems = 100): Promise<number> {
    const [header] = await suite.db().insert(lrUsers).values({
      username: `shop_${Math.random().toString(36).slice(2, 10)}`,
      isGuest: true,
      coins,
      gems,
    });
    return header.insertId;
  }

  /** The core seed ships no shop items — each test plants what it needs. */
  async function createItem(
    over: Partial<typeof lrShopItems.$inferInsert> = {},
  ): Promise<{ id: number; sku: string }> {
    const sku = over.sku ?? `sku_${Math.random().toString(36).slice(2, 10)}`;
    const [header] = await suite.db().insert(lrShopItems).values({
      sku,
      category: 'dice_skin',
      nameKey: `shop.${sku}`,
      assetKey: `dice:${sku}_`,
      priceCurrency: 'coins',
      priceAmount: 1000,
      isActive: true,
      ...over,
      sku,
    });
    return { id: header.insertId, sku };
  }

  it('buy happy path: debits coins and grants a permanent inventory row', async () => {
    const { shop, wallet, inventory } = build();
    const userId = await createUser();
    const item = await createItem();

    const result = await shop.buy(userId, item.sku);
    expect(result.paid).toEqual({ currency: 'coins', amount: 1000 });
    expect(result.granted).toEqual({ kind: 'inventory', expiresAt: null });

    expect((await wallet.getBalances(userId)).coins).toBe(9000);
    const ledger = await wallet.getLedger(userId);
    expect(ledger.entries[0]!.type).toBe('shop_purchase');
    expect(ledger.entries[0]!.refType).toBe('shop_item');
    expect(ledger.entries[0]!.refId).toBe(item.id);

    const backpack = await inventory.getInventory(userId);
    expect(backpack).toHaveLength(1);
    expect(backpack[0]!.itemId).toBe(item.id);
    expect(backpack[0]!.expiresAt).toBeNull();
  });

  it('insufficient funds: typed error, no inventory row, balance intact', async () => {
    const { shop, wallet, inventory } = build();
    const userId = await createUser(500); // item costs 1000
    const item = await createItem();

    await expect(shop.buy(userId, item.sku)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.INSUFFICIENT_FUNDS),
    );
    expect((await wallet.getBalances(userId)).coins).toBe(500);
    expect(await inventory.getInventory(userId)).toHaveLength(0);
  });

  it('duplicate permanent item → ERR_ALREADY_OWNED and the debit ROLLS BACK', async () => {
    const { shop, wallet } = build();
    const userId = await createUser();
    const item = await createItem();

    await shop.buy(userId, item.sku);
    await expect(shop.buy(userId, item.sku)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.ALREADY_OWNED),
    );
    // Only the first purchase was charged.
    expect((await wallet.getBalances(userId)).coins).toBe(9000);
  });

  it('temporal item sets expires_at ≈ now + duration_h', async () => {
    const { shop, inventory } = build();
    const userId = await createUser();
    const item = await createItem({ durationH: 24 });

    await shop.buy(userId, item.sku);
    const backpack = await inventory.getInventory(userId);
    const expires = backpack[0]!.expiresAt!.getTime();
    expect(expires).toBeGreaterThan(Date.now() + 23 * HOUR_MS);
    expect(expires).toBeLessThan(Date.now() + 25 * HOUR_MS);
  });

  it('currency pack: pays gems, credits coins, adds NO inventory row', async () => {
    const { shop, wallet, inventory } = build();
    const userId = await createUser(0, 100);
    const item = await createItem({
      category: 'coin_pack',
      priceCurrency: 'gems',
      priceAmount: 20,
      grantsCurrency: 'coins',
      grantsAmount: 5000,
    });

    const result = await shop.buy(userId, item.sku);
    expect(result.granted).toEqual({ kind: 'currency', currency: 'coins', amount: 5000 });
    const balances = await wallet.getBalances(userId);
    expect(balances.gems).toBe(80);
    expect(balances.coins).toBe(5000);
    expect(await inventory.getInventory(userId)).toHaveLength(0);
  });

  it('inactive or out-of-window items are not purchasable', async () => {
    const { shop } = build();
    const userId = await createUser();
    const inactive = await createItem({ isActive: false });
    const expired = await createItem({ availableUntil: new Date(Date.now() - 1000) });

    for (const sku of [inactive.sku, expired.sku]) {
      await expect(shop.buy(userId, sku)).rejects.toSatisfy((err: unknown) =>
        isApiError(err, API_ERR.ITEM_UNAVAILABLE),
      );
    }
  });

  it('equip: one equipped per category; equipping B unequips A', async () => {
    const { shop, inventory, db } = build();
    const userId = await createUser();
    const a = await createItem();
    const b = await createItem();
    await shop.buy(userId, a.sku);
    await shop.buy(userId, b.sku);

    await inventory.equip(userId, a.id);
    const afterB = await inventory.equip(userId, b.id);
    expect(afterB.isEquipped).toBe(true);

    const equipped = await db
      .select({ itemId: lrUserInventory.itemId })
      .from(lrUserInventory)
      .where(and(eq(lrUserInventory.userId, userId), eq(lrUserInventory.isEquipped, true)));
    expect(equipped).toHaveLength(1);
    expect(equipped[0]!.itemId).toBe(b.id);
  });

  it('unequip clears the category (back to the built-in default)', async () => {
    const { shop, inventory, db } = build();
    const userId = await createUser();
    const skin = await createItem(); // dice_skin by default
    await shop.buy(userId, skin.sku);
    await inventory.equip(userId, skin.id);

    const result = await inventory.unequip(userId, 'dice_skin');
    expect(result.cleared).toBe(1);
    const equipped = await db
      .select({ id: lrUserInventory.id })
      .from(lrUserInventory)
      .where(and(eq(lrUserInventory.userId, userId), eq(lrUserInventory.isEquipped, true)));
    expect(equipped).toHaveLength(0);

    // Idempotent: a second unequip clears nothing and does not throw.
    expect((await inventory.unequip(userId, 'dice_skin')).cleared).toBe(0);
    // Non-equippable categories are rejected with a typed error.
    await expect(inventory.unequip(userId, 'coin_pack')).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.VALIDATION),
    );
  });

  it('unequipping an avatar resets lr_users.avatar_key to its default', async () => {
    const { shop, inventory, db } = build();
    const userId = await createUser();
    const avatar = await createItem({ category: 'avatar', assetKey: 'ui:av_pirate' });
    await shop.buy(userId, avatar.sku);
    await inventory.equip(userId, avatar.id);

    await inventory.unequip(userId, 'avatar');
    const users = await db
      .select({ avatarKey: lrUsers.avatarKey })
      .from(lrUsers)
      .where(eq(lrUsers.id, userId));
    expect(users[0]!.avatarKey).toBe('av_default');
  });

  it('equipping an avatar mirrors lr_users.avatar_key', async () => {
    const { shop, inventory, db } = build();
    const userId = await createUser();
    const avatar = await createItem({ category: 'avatar', assetKey: 'ui:av_ninja' });
    await shop.buy(userId, avatar.sku);
    await inventory.equip(userId, avatar.id);

    const users = await db
      .select({ avatarKey: lrUsers.avatarKey })
      .from(lrUsers)
      .where(eq(lrUsers.id, userId));
    expect(users[0]!.avatarKey).toBe('ui:av_ninja');
  });

  it('equip of an expired item is rejected; sweepExpired removes it', async () => {
    const { shop, inventory, db } = build();
    const userId = await createUser();
    const temporal = await createItem({ durationH: 1 });
    const permanent = await createItem();
    await shop.buy(userId, temporal.sku);
    await shop.buy(userId, permanent.sku);

    // Force the temporal row into the past.
    await db
      .update(lrUserInventory)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(lrUserInventory.userId, userId), eq(lrUserInventory.itemId, temporal.id)));

    await expect(inventory.equip(userId, temporal.id)).rejects.toSatisfy((err: unknown) =>
      isApiError(err, API_ERR.ITEM_EXPIRED),
    );

    const swept = await inventory.sweepExpired();
    expect(swept).toBeGreaterThanOrEqual(1);
    const backpack = await inventory.getInventory(userId);
    expect(backpack).toHaveLength(1);
    expect(backpack[0]!.itemId).toBe(permanent.id);
  });
});
