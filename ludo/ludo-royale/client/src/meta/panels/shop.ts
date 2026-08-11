/**
 * SHOP panel (STYLE-GUIDE §6-D) — real catalog from GET /shop in LW-style
 * tabs per cosmetic type: Dados, Peones, Burbujas, Temas, Monedas, Gemas.
 * Virtual-currency purchases only (IAP tiles render disabled — §8.3 store
 * flow is a later sprint). Buying uses a two-tap inline confirmation (the
 * panel itself is the single allowed modal), then POST /shop/purchase →
 * currency packs fly their grant to the HUD, skins flip to Owned; balances
 * refresh after every buy. Ownership dedupe comes from GET /inventory.
 */
import { errText, t, tDyn } from '../../i18n';
import { api, MetaApiError } from '../api';
import type { ShopItem } from '../api';
import { formatCompact } from '../format';
import { refreshEquipment, refreshProfile } from '../store';
import { button, dragScroll, el, flyReward, openPanel, textureImg, toast } from '../ui';

export type ShopTab = 'dice' | 'pawns' | 'bubbles' | 'themes' | 'powers' | 'coins' | 'gems';

export function openShopPanel(initialTab: ShopTab = 'dice'): void {
  openPanel(
    t('shop.title'),
    ({ body }) => {
      body.append(el('p', 'lr-muted lr-center', t('common.loading')));
      void Promise.all([api.getShop(), api.getInventory()])
        .then(([shop, inventory]) => {
          body.replaceChildren();
          const owned = new Set(inventory.items.map((i) => i.itemId));
          // Consumables (powers) show how many the player already owns.
          const qtyByItem = new Map(inventory.items.map((i) => [i.itemId, i.qty]));
          render(body, shop.items, owned, qtyByItem, initialTab);
        })
        .catch((err: unknown) => {
          body.replaceChildren(el('p', 'lr-muted lr-center', describeError(err)));
        });
    },
    { wide: true },
  );
}

function render(
  body: HTMLElement,
  items: ShopItem[],
  owned: Set<number>,
  qtyByItem: Map<number, number>,
  initialTab: ShopTab,
): void {
  const tabs = el('div', 'lr-tabs');
  const rail = el('div', 'lr-tabs__rail');
  tabs.append(rail);
  dragScroll(rail);
  const grid = el('div', 'lr-shop__grid');
  body.append(tabs, grid);

  // Each tab wears its icon — plain labels read flat (Jose feedback).
  const tabDefs: ReadonlyArray<{ id: ShopTab; label: string }> = [
    { id: 'dice', label: `\u{1F3B2} ${t('shop.tab_dice')}` },
    { id: 'pawns', label: `\u265F\uFE0F ${t('shop.tab_pawns')}` },
    { id: 'bubbles', label: `\u{1F4AC} ${t('shop.tab_bubbles')}` },
    { id: 'themes', label: `\u{1F3A8} ${t('shop.tab_themes')}` },
    { id: 'powers', label: `\u26A1 ${t('shop.tab_powers')}` },
    { id: 'coins', label: `\u{1FA99} ${t('shop.tab_coins')}` },
    { id: 'gems', label: `\u{1F48E} ${t('shop.tab_gems')}` },
  ];
  const tabButtons = new Map<ShopTab, HTMLButtonElement>();

  const show = (tab: ShopTab): void => {
    for (const [id, btn] of tabButtons) btn.classList.toggle('lr-tab--active', id === tab);
    // Keep the active chip visible inside the scrolling rail.
    tabButtons.get(tab)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    grid.replaceChildren();
    const list = items.filter((item) => tabOf(item) === tab);
    if (list.length === 0) {
      grid.append(el('p', 'lr-muted lr-center lr-shop__empty', t('shop.empty')));
      return;
    }
    for (const item of list) grid.append(buildCard(item, owned, qtyByItem));
  };

  for (const def of tabDefs) {
    const btn = button('lr-tab', def.label, () => show(def.id));
    tabButtons.set(def.id, btn);
    rail.append(btn);
  }
  show(initialTab);
}

function tabOf(item: ShopItem): ShopTab {
  switch (item.category) {
    case 'booster':
      return 'powers';
    case 'coin_pack':
      return 'coins';
    case 'gem_pack':
      return 'gems';
    case 'token_skin':
    case 'avatar':
      return 'pawns';
    case 'bubble_skin':
    case 'emote_pack':
      return 'bubbles';
    case 'board_theme':
      return 'themes';
    default:
      return 'dice';
  }
}

function buildCard(item: ShopItem, owned: Set<number>, qtyByItem: Map<number, number>): HTMLElement {
  const card = el('div', 'lr-shop__card');
  if (item.isFeatured) card.append(el('span', 'lr-shop__featured', 'HOT!'));

  card.append(artFor(item));
  card.append(el('span', 'lr-shop__name', itemName(item)));
  // Powers are consumables: show the owned stack (updates after each buy).
  let qtyBadge: HTMLElement | null = null;
  if (item.category === 'booster') {
    const qty = qtyByItem.get(item.id) ?? 0;
    qtyBadge = el('span', 'lr-shop__grant', t('shop.owned_qty', { n: qty }));
    card.append(qtyBadge);
  }
  if (item.grantsCurrency !== null && item.grantsAmount !== null) {
    card.append(
      el('span', 'lr-shop__grant', `×${formatCompact(item.grantsAmount)}`),
    );
  }

  const isPermanent =
    item.grantsCurrency === null && item.category !== 'booster' && item.durationH === null;
  if (isPermanent && owned.has(item.id)) {
    card.append(el('span', 'lr-shop__owned', t('shop.owned')));
    return card;
  }
  if (item.priceCurrency === 'iap') {
    const iap = button('lr-btn lr-btn--price lr-btn--disabled', t('shop.iap'), () => undefined);
    iap.disabled = true;
    card.append(iap);
    return card;
  }

  // Two-tap confirm: first tap arms the button, second tap buys (resets 3s).
  const priceLabel =
    item.priceCurrency === 'free'
      ? t('shop.free')
      : `${formatCompact(item.priceAmount)} ${priceGlyph(item.priceCurrency)}`;
  let armed = false;
  let armTimer = 0;
  const buyBtn = button('lr-btn lr-btn--price', priceLabel, () => {
    if (!armed) {
      armed = true;
      buyBtn.textContent = `${t('shop.confirm_yes')}: ${priceLabel}`;
      buyBtn.classList.add('lr-btn--armed');
      armTimer = window.setTimeout(() => disarm(), 3000);
      return;
    }
    window.clearTimeout(armTimer);
    buyBtn.disabled = true;
    void api
      .purchase(item.sku)
      .then((result) => {
        toast(t('shop.purchased'));
        // Cosmetics equip themselves on purchase — buying IS choosing (the
        // Backpack still lets you switch back to classic later).
        if (
          result.granted.kind !== 'currency' &&
          ['dice_skin', 'token_skin', 'bubble_skin', 'board_theme'].includes(item.category)
        ) {
          void api
            .equip(item.id)
            .then(() => refreshEquipment())
            .catch(() => undefined);
        }
        if (result.granted.kind === 'currency') {
          flyReward(result.granted.currency, card, 8);
        } else {
          owned.add(item.id);
          if (item.category === 'booster' && qtyBadge) {
            const qty = (qtyByItem.get(item.id) ?? 0) + 1;
            qtyByItem.set(item.id, qty);
            qtyBadge.textContent = t('shop.owned_qty', { n: qty });
          }
          if (isPermanent) {
            buyBtn.remove();
            card.append(el('span', 'lr-shop__owned', t('shop.owned')));
          }
        }
        void refreshProfile().catch(() => null);
        disarm();
        buyBtn.disabled = false;
      })
      .catch((err: unknown) => {
        toast(describeError(err));
        disarm();
        buyBtn.disabled = false;
      });
  });
  const disarm = (): void => {
    armed = false;
    buyBtn.textContent = priceLabel;
    buyBtn.classList.remove('lr-btn--armed');
  };
  card.append(buyBtn);
  return card;
}

function artFor(item: ShopItem): HTMLElement {
  if (item.category === 'coin_pack') {
    return textureImg('coin_gold', 'lr-shop__art', 'lr-coin--css');
  }
  if (item.category === 'gem_pack') {
    return textureImg('gem_violet', 'lr-shop__art', 'lr-gem--css');
  }
  if (item.category === 'dice_skin') {
    const key = item.assetKey !== null ? `dice_${item.assetKey}_face_5` : 'dice_face_5';
    return textureImg(key, 'lr-shop__art', 'lr-chest--css');
  }
  if (item.category === 'token_skin') {
    const key = item.assetKey !== null ? `piece_red_s_${item.assetKey}` : 'piece_red';
    return textureImg(key, 'lr-shop__art', 'lr-chest--css');
  }
  if (item.category === 'bubble_skin') {
    return textureImg(`bubble_prev_${item.assetKey ?? 'classic'}`, 'lr-shop__art', 'lr-chest--css');
  }
  if (item.category === 'board_theme') {
    return textureImg(`board_prev_${item.assetKey ?? 'classic'}`, 'lr-shop__art', 'lr-chest--css');
  }
  if (item.category === 'avatar') {
    return textureImg('piece_blue_face', 'lr-shop__art', 'lr-chest--css');
  }
  if (item.category === 'booster') {
    // Power medallions are baked at Splash boot (bakePowers) — asset_key
    // matches the PowerType, so `power_<assetKey>` is the texture key.
    return textureImg(`power_${item.assetKey ?? 'plus'}`, 'lr-shop__art', 'lr-chest--css');
  }
  return textureImg('art_chest', 'lr-shop__art', 'lr-chest--css');
}

/** name_key → i18n (`shop.item.<key>`) with a humanized fallback. */
function itemName(item: ShopItem): string {
  return tDyn(`shop.item.${item.nameKey}`, humanize(item.nameKey));
}

function humanize(key: string): string {
  return key
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function priceGlyph(currency: 'coins' | 'gems'): string {
  return currency === 'coins' ? t('hud.coins') : t('hud.gems');
}

function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return errText(err.code, t('err.ERR_INTERNAL'));
  return t('err.ERR_NETWORK');
}
