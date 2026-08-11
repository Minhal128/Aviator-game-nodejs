-- §7.5 shop: add the `bubble_skin` cosmetic category (chat-bubble palettes).
-- Idempotent: MODIFY to the same definition is a no-op, and the migration
-- runner executes every file on every run.
ALTER TABLE `lr_shop_items`
  MODIFY COLUMN `category` ENUM(
    'dice_skin',
    'token_skin',
    'board_theme',
    'avatar',
    'avatar_frame',
    'emote_pack',
    'coin_pack',
    'gem_pack',
    'booster',
    'bubble_skin'
  ) NOT NULL;
