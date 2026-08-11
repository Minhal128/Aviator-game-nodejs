-- ===========================================================================
-- Ludo Royale — baseline migration 0000_init
-- The COMPLETE 41-table blueprint of ARQUITECTURA §7 (v1.0 + v1.1 + v2).
-- The installer creates every table on day 1; later phases are feature
-- flags + UI, never destructive migrations (PROMPT-V3 §2).
--
-- Hand-written reference coherent with src/db/schema.ts. `drizzle-kit
-- generate` output may differ cosmetically (IF NOT EXISTS, index direction);
-- THIS file is the installer/test baseline.
--
-- Conventions: InnoDB · utf8mb4_unicode_ci · DATETIME in UTC (app-written) ·
-- money in BIGINT (never FLOAT) · explicit ON DELETE on every FK.
-- FK checks are disabled while creating so section order can follow §7.
-- ===========================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- §7.1 Identity & sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(24) NOT NULL,
  `email` VARCHAR(190) NULL,
  `password_hash` VARCHAR(255) NULL,
  `is_guest` TINYINT(1) NOT NULL DEFAULT 1,
  `device_id` VARCHAR(64) NULL,
  `avatar_key` VARCHAR(40) NOT NULL DEFAULT 'av_default',
  `frame_key` VARCHAR(40) NULL,
  `country` CHAR(2) NULL,
  `locale` CHAR(2) NOT NULL DEFAULT 'en',
  `xp` INT UNSIGNED NOT NULL DEFAULT 0,
  `level` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `coins` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `gems` INT UNSIGNED NOT NULL DEFAULT 0,
  `games_played` INT UNSIGNED NOT NULL DEFAULT 0,
  `games_won` INT UNSIGNED NOT NULL DEFAULT 0,
  `win_streak` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `referral_code` VARCHAR(12) NULL,
  `referred_by` BIGINT UNSIGNED NULL,
  `status` ENUM('active','banned','deleted') NOT NULL DEFAULT 'active',
  `ban_reason` VARCHAR(190) NULL,
  `banned_until` DATETIME NULL,
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_username` (`username`),
  UNIQUE KEY `uq_email` (`email`),
  UNIQUE KEY `uq_referral_code` (`referral_code`),
  KEY `idx_device` (`device_id`),
  KEY `idx_status` (`status`),
  KEY `idx_level` (`level`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_users_referred_by` FOREIGN KEY (`referred_by`) REFERENCES `lr_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- family_id: root session of the rotation chain (§8.2 token-family — reuse of
-- a rotated refresh revokes the whole family with one indexed UPDATE).
CREATE TABLE IF NOT EXISTS `lr_user_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `refresh_token_hash` CHAR(64) NOT NULL,
  `family_id` BIGINT UNSIGNED NULL,
  `device_info` VARCHAR(190) NULL,
  `ip` VARCHAR(45) NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `rotated_from` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_hash` (`refresh_token_hash`),
  KEY `idx_sessions_user` (`user_id`),
  KEY `idx_sessions_family` (`family_id`),
  KEY `idx_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.2 Economy
-- ---------------------------------------------------------------------------

-- Append-only: the app never UPDATEs/DELETEs here (runtime MySQL user may be
-- restricted to INSERT/SELECT). No polymorphic UNIQUE on (ref_type, ref_id):
-- dedupe lives in the origin tables (Gate 1 fix). 'signup_bonus' added so the
-- guest starter grant satisfies SUM(ledger) == balance.
CREATE TABLE IF NOT EXISTS `lr_wallet_transactions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `currency` ENUM('coins','gems') NOT NULL,
  `amount` BIGINT NOT NULL,
  `balance_after` BIGINT UNSIGNED NOT NULL,
  `type` ENUM('match_entry','match_prize','daily_bonus','mission_reward','shop_purchase','iap_grant','ad_reward','wheel_prize','event_reward','referral_bonus','mail_attachment','level_up','admin_adjust','refund','signup_bonus') NOT NULL,
  `ref_type` VARCHAR(32) NULL,
  `ref_id` BIGINT UNSIGNED NULL,
  `note` VARCHAR(190) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wallet_user_created` (`user_id`,`created_at`),
  KEY `idx_wallet_type` (`type`),
  KEY `idx_wallet_ref` (`ref_type`,`ref_id`),
  KEY `idx_created_type` (`created_at`,`type`),
  CONSTRAINT `fk_wallet_tx_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_room_tiers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(40) NOT NULL,
  `mode` ENUM('classic','power','minimap') NOT NULL DEFAULT 'classic',
  `entry_fee_coins` BIGINT UNSIGNED NOT NULL,
  `prize_table` JSON NOT NULL,
  `min_level` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_xp_levels` (
  `level` SMALLINT UNSIGNED NOT NULL,
  `xp_required` INT UNSIGNED NOT NULL,
  `reward_coins` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `reward_gems` INT UNSIGNED NOT NULL DEFAULT 0,
  `reward_item_id` BIGINT UNSIGNED NULL,
  PRIMARY KEY (`level`),
  CONSTRAINT `fk_xp_levels_item` FOREIGN KEY (`reward_item_id`) REFERENCES `lr_shop_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.3 Matches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_matches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mode` ENUM('classic','power','minimap') NOT NULL,
  `type` ENUM('quick','private','cpu','local') NOT NULL,
  `tier_id` BIGINT UNSIGNED NULL,
  `room_id` VARCHAR(12) NULL,
  `private_code` CHAR(6) NULL,
  `max_players` TINYINT UNSIGNED NOT NULL,
  `entry_fee` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `pot` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `state` ENUM('playing','finished','aborted') NOT NULL,
  `winner_user_id` BIGINT UNSIGNED NULL,
  `seed_hash` CHAR(64) NULL,
  `rng_rolls` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `started_at` DATETIME NULL,
  `ended_at` DATETIME NULL,
  `duration_s` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_private_code` (`private_code`),
  KEY `idx_state` (`state`),
  KEY `idx_started` (`started_at`),
  KEY `idx_state_started` (`state`,`started_at`),
  CONSTRAINT `fk_matches_tier` FOREIGN KEY (`tier_id`) REFERENCES `lr_room_tiers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_matches_winner` FOREIGN KEY (`winner_user_id`) REFERENCES `lr_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_match_players` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `match_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `seat` TINYINT UNSIGNED NOT NULL,
  `color` ENUM('red','blue','yellow','green') NOT NULL,
  `is_bot` TINYINT(1) NOT NULL DEFAULT 0,
  `place` TINYINT UNSIGNED NULL,
  `pieces_home` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `captures` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `sixes` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `coins_delta` BIGINT NOT NULL DEFAULT 0,
  `xp_earned` INT UNSIGNED NOT NULL DEFAULT 0,
  `left_early` TINYINT(1) NOT NULL DEFAULT 0,
  `disconnects` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_match_seat` (`match_id`,`seat`),
  KEY `idx_user_history` (`user_id`,`id` DESC),
  CONSTRAINT `fk_match_players_match` FOREIGN KEY (`match_id`) REFERENCES `lr_matches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_match_players_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.4 Retention (missions, daily bonus, streaks)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_missions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `period` ENUM('daily','weekly','event') NOT NULL DEFAULT 'daily',
  `metric` ENUM('play_matches','win_matches','capture_pieces','roll_sixes','pieces_home','watch_ads','spend_coins','use_emotes') NOT NULL,
  `target` INT UNSIGNED NOT NULL,
  `reward_type` ENUM('coins','gems','item') NOT NULL,
  `reward_amount` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `reward_item_id` BIGINT UNSIGNED NULL,
  `min_level` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `event_id` BIGINT UNSIGNED NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mission_code` (`code`),
  CONSTRAINT `fk_missions_item` FOREIGN KEY (`reward_item_id`) REFERENCES `lr_shop_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_missions_event` FOREIGN KEY (`event_id`) REFERENCES `lr_events` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UNIQUE(user_id, mission_id, period_key) is the reward dedupe (§7.2).
CREATE TABLE IF NOT EXISTS `lr_user_missions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `mission_id` BIGINT UNSIGNED NOT NULL,
  `period_key` VARCHAR(16) NOT NULL,
  `progress` INT UNSIGNED NOT NULL DEFAULT 0,
  `completed_at` DATETIME NULL,
  `claimed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_mission_period` (`user_id`,`mission_id`,`period_key`),
  CONSTRAINT `fk_user_missions_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_missions_mission` FOREIGN KEY (`mission_id`) REFERENCES `lr_missions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_daily_bonus_config` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `day` TINYINT UNSIGNED NOT NULL,
  `reward_type` ENUM('coins','gems','item') NOT NULL,
  `amount` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `item_id` BIGINT UNSIGNED NULL,
  `item_duration_h` INT UNSIGNED NULL,
  `double_with_ad` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_day` (`day`),
  CONSTRAINT `fk_daily_bonus_item` FOREIGN KEY (`item_id`) REFERENCES `lr_shop_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_user_streaks` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `current_day` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `streak_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_claim_date` DATE NULL,
  `total_claims` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_user_streaks_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.5 Shop & inventory
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_shop_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sku` VARCHAR(40) NOT NULL,
  `category` ENUM('dice_skin','token_skin','board_theme','avatar','avatar_frame','emote_pack','coin_pack','gem_pack','booster') NOT NULL,
  `name_key` VARCHAR(80) NOT NULL,
  `desc_key` VARCHAR(80) NULL,
  `asset_key` VARCHAR(80) NULL,
  `price_currency` ENUM('coins','gems','iap','free') NOT NULL,
  `price_amount` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `iap_product_id` VARCHAR(80) NULL,
  `grants_currency` ENUM('coins','gems') NULL,
  `grants_amount` BIGINT UNSIGNED NULL,
  `duration_h` INT UNSIGNED NULL,
  `min_level` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `is_featured` TINYINT(1) NOT NULL DEFAULT 0,
  `available_from` DATETIME NULL,
  `available_until` DATETIME NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sku` (`sku`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_user_inventory` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `item_id` BIGINT UNSIGNED NOT NULL,
  `qty` INT UNSIGNED NOT NULL DEFAULT 1,
  `acquired_via` ENUM('shop','daily_bonus','wheel','event','mail','referral','admin','iap','level_up') NOT NULL,
  `is_equipped` TINYINT(1) NOT NULL DEFAULT 0,
  `expires_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_item` (`user_id`,`item_id`),
  KEY `idx_inventory_user` (`user_id`),
  KEY `idx_inventory_expires` (`expires_at`),
  CONSTRAINT `fk_inventory_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_inventory_item` FOREIGN KEY (`item_id`) REFERENCES `lr_shop_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.6 Leaderboard, mail, emotes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_leaderboard_live` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope` ENUM('global','country') NOT NULL,
  `period_key` VARCHAR(10) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `score` BIGINT NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_scope_period_user` (`scope`,`period_key`,`user_id`),
  KEY `idx_rank` (`scope`,`period_key`,`score` DESC),
  CONSTRAINT `fk_leaderboard_live_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_leaderboard_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope` ENUM('global','country') NOT NULL,
  `country` CHAR(2) NULL,
  `period` ENUM('weekly','alltime') NOT NULL,
  `period_key` VARCHAR(10) NOT NULL,
  `rank` INT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `score` BIGINT NOT NULL,
  `snapshot_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_snapshot_rank` (`scope`,`country`,`period`,`period_key`,`rank`),
  CONSTRAINT `fk_leaderboard_snapshots_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_mail_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `audience` ENUM('all','user') NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `title` VARCHAR(120) NOT NULL,
  `body` TEXT NOT NULL,
  `attachment_type` ENUM('none','coins','gems','item') NOT NULL DEFAULT 'none',
  `attachment_amount` BIGINT UNSIGNED NULL,
  `attachment_item_id` BIGINT UNSIGNED NULL,
  `attachment_item_duration_h` INT UNSIGNED NULL,
  `expires_at` DATETIME NULL,
  `created_by_admin_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_mail_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mail_item` FOREIGN KEY (`attachment_item_id`) REFERENCES `lr_shop_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mail_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `lr_admin_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UNIQUE(user_id, mail_id) is the attachment-claim dedupe (§7.2).
CREATE TABLE IF NOT EXISTS `lr_user_mail` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `mail_id` BIGINT UNSIGNED NOT NULL,
  `read_at` DATETIME NULL,
  `claimed_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_mail` (`user_id`,`mail_id`),
  CONSTRAINT `fk_user_mail_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_mail_mail` FOREIGN KEY (`mail_id`) REFERENCES `lr_mail_messages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_emotes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(24) NOT NULL,
  `asset_key` VARCHAR(80) NOT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emote_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.7 Social (v1.1 — schema day 1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_friends` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `friend_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_friend` (`user_id`,`friend_id`),
  CONSTRAINT `fk_friends_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_friends_friend` FOREIGN KEY (`friend_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_friend_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `from_user_id` BIGINT UNSIGNED NOT NULL,
  `to_user_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_to_status` (`to_user_id`,`status`),
  CONSTRAINT `fk_friend_requests_from` FOREIGN KEY (`from_user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_friend_requests_to` FOREIGN KEY (`to_user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_referrals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `referrer_user_id` BIGINT UNSIGNED NOT NULL,
  `referred_user_id` BIGINT UNSIGNED NOT NULL,
  `code_used` VARCHAR(12) NOT NULL,
  `status` ENUM('registered','qualified','rewarded') NOT NULL DEFAULT 'registered',
  `rewarded_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_referrer` (`referrer_user_id`),
  UNIQUE KEY `uq_referred` (`referred_user_id`),
  CONSTRAINT `fk_referrals_referrer` FOREIGN KEY (`referrer_user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_referrals_referred` FOREIGN KEY (`referred_user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.8 Lucky Wheel (v1.1 — schema day 1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_lucky_wheel_config` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(40) NOT NULL,
  `free_spins_daily` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `extra_spin_cost_type` ENUM('gems','ad') NULL,
  `extra_spin_cost_amount` INT UNSIGNED NULL,
  `max_spins_daily` TINYINT UNSIGNED NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_lucky_wheel_segments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `wheel_id` BIGINT UNSIGNED NOT NULL,
  `label_key` VARCHAR(80) NOT NULL,
  `reward_type` ENUM('coins','gems','item') NOT NULL,
  `amount` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `item_id` BIGINT UNSIGNED NULL,
  `weight` INT UNSIGNED NOT NULL,
  `color` CHAR(7) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_wheel_segments_wheel` FOREIGN KEY (`wheel_id`) REFERENCES `lr_lucky_wheel_config` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wheel_segments_item` FOREIGN KEY (`item_id`) REFERENCES `lr_shop_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_lucky_wheel_spins` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `wheel_id` BIGINT UNSIGNED NOT NULL,
  `segment_id` BIGINT UNSIGNED NOT NULL,
  `cost_type` ENUM('free','gems','ad') NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_spins_user_created` (`user_id`,`created_at`),
  CONSTRAINT `fk_wheel_spins_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wheel_spins_wheel` FOREIGN KEY (`wheel_id`) REFERENCES `lr_lucky_wheel_config` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wheel_spins_segment` FOREIGN KEY (`segment_id`) REFERENCES `lr_lucky_wheel_segments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.9 Events (v1.1) & tournaments (v2) — schema day 1
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `type` ENUM('collect','offer') NOT NULL,
  `title_key` VARCHAR(80) NOT NULL,
  `asset_key` VARCHAR(80) NULL,
  `config` JSON NULL,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_code` (`code`),
  KEY `idx_ends` (`ends_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_event_rewards` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` BIGINT UNSIGNED NOT NULL,
  `milestone` INT UNSIGNED NOT NULL,
  `reward_type` ENUM('coins','gems','item') NOT NULL,
  `amount` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `item_id` BIGINT UNSIGNED NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_event_rewards_event` FOREIGN KEY (`event_id`) REFERENCES `lr_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_event_rewards_item` FOREIGN KEY (`item_id`) REFERENCES `lr_shop_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_user_event_progress` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `event_id` BIGINT UNSIGNED NOT NULL,
  `progress` INT UNSIGNED NOT NULL DEFAULT 0,
  `claimed_milestones` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_event` (`user_id`,`event_id`),
  CONSTRAINT `fk_event_progress_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_event_progress_event` FOREIGN KEY (`event_id`) REFERENCES `lr_events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Virtual coins ONLY — never real money (Envato AUP).
CREATE TABLE IF NOT EXISTS `lr_tournaments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(80) NOT NULL,
  `mode` ENUM('classic','power') NOT NULL DEFAULT 'classic',
  `entry_fee_coins` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `max_players` SMALLINT UNSIGNED NOT NULL,
  `state` ENUM('registration','running','finished','cancelled') NOT NULL DEFAULT 'registration',
  `prize_table` JSON NULL,
  `registration_ends_at` DATETIME NULL,
  `starts_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_tournament_players` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tournament_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `seed` INT UNSIGNED NULL,
  `eliminated_round` TINYINT UNSIGNED NULL,
  `final_place` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tournament_user` (`tournament_id`,`user_id`),
  CONSTRAINT `fk_tournament_players_tournament` FOREIGN KEY (`tournament_id`) REFERENCES `lr_tournaments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tournament_players_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_tournament_matches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tournament_id` BIGINT UNSIGNED NOT NULL,
  `round` TINYINT UNSIGNED NOT NULL,
  `slot` INT UNSIGNED NOT NULL,
  `player_ids` JSON NULL,
  `match_id` BIGINT UNSIGNED NULL,
  `winner_user_id` BIGINT UNSIGNED NULL,
  `state` ENUM('pending','playing','finished') NOT NULL DEFAULT 'pending',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tournament_round_slot` (`tournament_id`,`round`,`slot`),
  CONSTRAINT `fk_tournament_matches_tournament` FOREIGN KEY (`tournament_id`) REFERENCES `lr_tournaments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tournament_matches_match` FOREIGN KEY (`match_id`) REFERENCES `lr_matches` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tournament_matches_winner` FOREIGN KEY (`winner_user_id`) REFERENCES `lr_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.10 Configuration, admin & monetization
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_settings` (
  `key` VARCHAR(64) NOT NULL,
  `value` TEXT NOT NULL,
  `type` ENUM('string','int','bool','json') NOT NULL DEFAULT 'string',
  `grp` VARCHAR(32) NOT NULL DEFAULT 'general',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_feature_flags` (
  `flag` VARCHAR(48) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `description` VARCHAR(190) NULL,
  `phase` ENUM('v1.0','v1.1','v2') NOT NULL DEFAULT 'v1.0',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`flag`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_admin_users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(190) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `role` ENUM('superadmin','ops','support','viewer') NOT NULL DEFAULT 'viewer',
  `totp_secret` VARCHAR(64) NULL,
  `last_login_at` DATETIME NULL,
  `failed_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until` DATETIME NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admin_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only audit trail of every admin mutation (§9.6).
CREATE TABLE IF NOT EXISTS `lr_admin_audit_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` BIGINT UNSIGNED NULL,
  `action` VARCHAR(64) NOT NULL,
  `entity` VARCHAR(48) NOT NULL,
  `entity_id` VARCHAR(48) NULL,
  `before_json` JSON NULL,
  `after_json` JSON NULL,
  `ip` VARCHAR(45) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_created` (`admin_id`,`created_at`),
  KEY `idx_entity` (`entity`,`entity_id`),
  CONSTRAINT `fk_audit_admin` FOREIGN KEY (`admin_id`) REFERENCES `lr_admin_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_iap_products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `store_sku` VARCHAR(80) NOT NULL,
  `platform` ENUM('android','ios') NOT NULL,
  `shop_item_id` BIGINT UNSIGNED NOT NULL,
  `price_usd` DECIMAL(8,2) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_store_sku_platform` (`store_sku`,`platform`),
  CONSTRAINT `fk_iap_products_item` FOREIGN KEY (`shop_item_id`) REFERENCES `lr_shop_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UNIQUE(event_id) + UNIQUE(transaction_id) are the IAP grant dedupe (§7.2).
CREATE TABLE IF NOT EXISTS `lr_iap_receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `platform` ENUM('android','ios') NOT NULL,
  `provider` ENUM('revenuecat','google','apple') NOT NULL,
  `store_sku` VARCHAR(80) NOT NULL,
  `event_id` VARCHAR(120) NULL,
  `transaction_id` VARCHAR(120) NULL,
  `status` ENUM('granted','refunded','invalid','pending') NOT NULL,
  `amount_usd` DECIMAL(8,2) NULL,
  `raw_payload` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_iap_user` (`user_id`),
  UNIQUE KEY `uq_event_id` (`event_id`),
  UNIQUE KEY `uq_transaction_id` (`transaction_id`),
  CONSTRAINT `fk_iap_receipts_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UNIQUE(ssv_transaction_id) is the AdMob SSV dedupe (§8.4).
CREATE TABLE IF NOT EXISTS `lr_ad_rewards` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `network` ENUM('admob') NOT NULL DEFAULT 'admob',
  `placement` ENUM('daily_double','wheel_spin','coin_boost','mission_skip') NOT NULL,
  `ssv_transaction_id` VARCHAR(120) NOT NULL,
  `reward_type` ENUM('coins','gems','x2_bonus') NOT NULL,
  `amount` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `verified` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ssv_transaction` (`ssv_transaction_id`),
  KEY `idx_ads_user_created` (`user_id`,`created_at`),
  CONSTRAINT `fk_ad_rewards_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_i18n_strings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `locale` CHAR(2) NOT NULL,
  `namespace` VARCHAR(32) NOT NULL,
  `str_key` VARCHAR(80) NOT NULL,
  `value` TEXT NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_locale_ns_key` (`locale`,`namespace`,`str_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.11 Push notifications (v1.1 — schema day 1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_push_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `platform` ENUM('android','ios','web') NOT NULL,
  `token` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token` (`token`),
  KEY `idx_push_user` (`user_id`),
  CONSTRAINT `fk_push_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §7.12 World chat (v2 — schema day 1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `lr_chat_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope` ENUM('global','match') NOT NULL,
  `match_id` BIGINT UNSIGNED NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `body` VARCHAR(200) NOT NULL,
  `flagged` TINYINT(1) NOT NULL DEFAULT 0,
  `deleted_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chat_created` (`created_at`),
  CONSTRAINT `fk_chat_messages_match` FOREIGN KEY (`match_id`) REFERENCES `lr_matches` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_messages_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lr_chat_mutes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `muted_until` DATETIME NOT NULL,
  `reason` VARCHAR(190) NULL,
  `created_by_admin_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_chat_mutes_user` FOREIGN KEY (`user_id`) REFERENCES `lr_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_mutes_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `lr_admin_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- 41 tables: 26 v1.0 + 10 v1.1 + 5 v2 (§7.13).
