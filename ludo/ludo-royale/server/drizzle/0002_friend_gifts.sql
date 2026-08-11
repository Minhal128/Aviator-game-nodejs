-- §7.7 social: daily friend coin gifts — one per (sender, receiver, UTC day).
-- The gift itself travels as a user mail with a coins attachment; this table
-- is the dedupe ledger. Idempotent (IF NOT EXISTS) like every migration.
CREATE TABLE IF NOT EXISTS `lr_friend_gifts` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `from_user_id` BIGINT UNSIGNED NOT NULL,
  `to_user_id` BIGINT UNSIGNED NOT NULL,
  `day_key` CHAR(10) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_gift_day` (`from_user_id`, `to_user_id`, `day_key`),
  KEY `idx_gift_to` (`to_user_id`),
  CONSTRAINT `fk_gift_from` FOREIGN KEY (`from_user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gift_to` FOREIGN KEY (`to_user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
);
