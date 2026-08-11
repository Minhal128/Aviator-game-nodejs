/**
 * BACKPACK panel (STYLE-GUIDE §6-E) — real inventory from GET /inventory
 * grouped by category. Equippable categories (dice/token skins, boards,
 * avatars, frames) get an Equip button → POST /inventory/equip (server
 * keeps one equipped per category and mirrors avatar/frame onto the
 * profile). The equipped tile wears the gold ribbon. Dice skins are LIVE
 * in-match: the dice section leads with a built-in "Classic" tile
 * (equipping it = POST /inventory/unequip) and every change syncs
 * store.diceSkin, which GameBoardScene reads at match start.
 */
import { errText, t, tDyn } from '../../i18n';
import type { I18nKey } from '../../i18n';
import { api, MetaApiError } from '../api';
import type { InventoryItem, ShopCategory } from '../api';
import { refreshEquipment } from '../store';
import { button, el, openPanel, textureImg, toast } from '../ui';

const EQUIPPABLE: ReadonlySet<ShopCategory> = new Set([
  'dice_skin',
  'token_skin',
  'bubble_skin',
  'board_theme',
  'avatar',
  'avatar_frame',
]);

const CATEGORY_ORDER: readonly ShopCategory[] = [
  'dice_skin',
  'token_skin',
  'bubble_skin',
  'board_theme',
  'avatar',
  'avatar_frame',
  'emote_pack',
  'booster',
  'coin_pack',
  'gem_pack',
];

/** Built-in default per category — equipping it = unequip the category. */
const DEFAULT_TILES: Partial<Record<ShopCategory, { art: string; labelKey: I18nKey }>> = {
  dice_skin: { art: 'dice_face_5', labelKey: 'backpack.default_dice' },
  token_skin: { art: 'piece_red', labelKey: 'backpack.default_token' },
  bubble_skin: { art: 'bubble_prev_classic', labelKey: 'backpack.default_bubble' },
  board_theme: { art: 'board_prev_classic', labelKey: 'backpack.default_board' },
};

export function openBackpackPanel(): void {
  openPanel(
    t('backpack.title'),
    ({ body }) => {
      body.append(el('p', 'lr-muted lr-center', t('common.loading')));
      const load = (): void => {
        void api
          .getInventory()
          .then(({ items }) => {
            body.replaceChildren();
            render(body, items, load);
          })
          .catch((err: unknown) => {
            body.replaceChildren(el('p', 'lr-muted lr-center', describeError(err)));
          });
      };
      load();
    },
    { wide: true },
  );
}

function render(body: HTMLElement, items: InventoryItem[], reload: () => void): void {
  if (items.length === 0) {
    body.append(el('p', 'lr-muted lr-center', t('backpack.empty')));
    return;
  }

  const byCategory = new Map<ShopCategory, InventoryItem[]>();
  for (const item of items) {
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push(item);
    byCategory.set(item.category, bucket);
  }

  for (const category of CATEGORY_ORDER) {
    const bucket = byCategory.get(category);
    if (!bucket || bucket.length === 0) continue;
    body.append(el('h3', 'lr-section-title', categoryLabel(category)));
    const grid = el('div', 'lr-backpack__grid');
    // Built-in default tile: owning any skin unlocks switching BACK to it.
    const def = DEFAULT_TILES[category];
    if (def) grid.append(buildDefaultTile(category, def, bucket, reload));
    for (const item of bucket) grid.append(buildTile(item, reload));
    body.append(grid);
  }

  body.append(el('p', 'lr-muted lr-center lr-backpack__note', t('backpack.skin_note')));
}

function buildTile(item: InventoryItem, reload: () => void): HTMLElement {
  const tile = el('div', `lr-backpack__tile${item.isEquipped ? ' lr-backpack__tile--equipped' : ''}`);
  tile.append(artFor(item));
  tile.append(el('span', 'lr-backpack__name', itemName(item)));
  if (item.qty > 1) tile.append(el('span', 'lr-backpack__qty', t('backpack.qty', { n: item.qty })));

  if (item.isEquipped) {
    tile.append(el('span', 'lr-backpack__ribbon', t('backpack.equipped')));
  } else if (EQUIPPABLE.has(item.category)) {
    const equip = button('lr-btn lr-btn--equip', t('backpack.equip'), () => {
      equip.disabled = true;
      void api
        .equip(item.itemId)
        .then(() => {
          void refreshEquipment();
          reload();
        })
        .catch((err: unknown) => {
          equip.disabled = false;
          toast(describeError(err));
        });
    });
    tile.append(equip);
  }
  return tile;
}

/** Synthetic tile for a category default — equipping it unequips the rest. */
function buildDefaultTile(
  category: ShopCategory,
  def: { art: string; labelKey: I18nKey },
  bucket: InventoryItem[],
  reload: () => void,
): HTMLElement {
  const isActive = !bucket.some((i) => i.isEquipped);
  const tile = el('div', `lr-backpack__tile${isActive ? ' lr-backpack__tile--equipped' : ''}`);
  tile.append(textureImg(def.art, 'lr-backpack__art', 'lr-chest--css'));
  tile.append(el('span', 'lr-backpack__name', t(def.labelKey)));
  if (isActive) {
    tile.append(el('span', 'lr-backpack__ribbon', t('backpack.equipped')));
  } else {
    const equip = button('lr-btn lr-btn--equip', t('backpack.equip'), () => {
      equip.disabled = true;
      void api
        .unequip(category)
        .then(() => {
          void refreshEquipment();
          reload();
        })
        .catch((err: unknown) => {
          equip.disabled = false;
          toast(describeError(err));
        });
    });
    tile.append(equip);
  }
  return tile;
}

function artFor(item: InventoryItem): HTMLElement {
  if (item.category === 'dice_skin') {
    const key = item.assetKey !== null ? `dice_${item.assetKey}_face_5` : 'dice_face_5';
    return textureImg(key, 'lr-backpack__art', 'lr-chest--css');
  }
  if (item.category === 'token_skin') {
    const key = item.assetKey !== null ? `piece_red_s_${item.assetKey}` : 'piece_red';
    return textureImg(key, 'lr-backpack__art', 'lr-chest--css');
  }
  if (item.category === 'bubble_skin') {
    return textureImg(`bubble_prev_${item.assetKey ?? 'classic'}`, 'lr-backpack__art', 'lr-chest--css');
  }
  if (item.category === 'board_theme') {
    return textureImg(`board_prev_${item.assetKey ?? 'classic'}`, 'lr-backpack__art', 'lr-chest--css');
  }
  if (item.category === 'avatar') {
    return textureImg('piece_blue_face', 'lr-backpack__art', 'lr-chest--css');
  }
  return textureImg('art_chest', 'lr-backpack__art', 'lr-chest--css');
}

function itemName(item: InventoryItem): string {
  return tDyn(
    `shop.item.${item.nameKey}`,
    item.nameKey.replace(/[._-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
  );
}

function categoryLabel(category: ShopCategory): string {
  return tDyn(`backpack.cat_${category}`, category.replace(/_/g, ' '));
}

function describeError(err: unknown): string {
  if (err instanceof MetaApiError) return errText(err.code, t('err.ERR_INTERNAL'));
  return t('err.ERR_NETWORK');
}
