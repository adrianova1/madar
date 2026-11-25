-- MADAR | مدار — Reference MySQL 8 / MariaDB Schema (Future Migration Blueprint)
-- NOTE: Current runtime uses SQLite (better-sqlite3) at DATABASE_PATH (default ./data/madar.db).
-- This schema mirrors the current tables for teams migrating to MySQL/PostgreSQL later.

CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  telegram_id VARCHAR(64) UNIQUE,
  username VARCHAR(40) NOT NULL UNIQUE,
  display_name VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255),
  phone VARCHAR(24),
  phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  gender VARCHAR(24) NOT NULL DEFAULT 'unspecified',
  birth_date VARCHAR(16),
  city VARCHAR(60) NOT NULL DEFAULT 'تهران',
  bio VARCHAR(260) NOT NULL DEFAULT '',
  interests_json JSON,
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  subscription_tier VARCHAR(16) NOT NULL DEFAULT 'free',
  level INT NOT NULL DEFAULT 1,
  xp INT NOT NULL DEFAULT 0,
  dating_enabled TINYINT(1) NOT NULL DEFAULT 0,
  is_banned TINYINT(1) NOT NULL DEFAULT 0,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  referral_code VARCHAR(40) NOT NULL UNIQUE,
  anon_slug VARCHAR(40) NOT NULL UNIQUE,
  allow_whispers TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS star_wallets (
  user_id BIGINT PRIMARY KEY,
  free_stars INT NOT NULL DEFAULT 100,
  paid_stars INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS star_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount INT NOT NULL,
  star_bucket ENUM('free', 'paid') NOT NULL DEFAULT 'free',
  tx_type VARCHAR(40) NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_star_tx_user (user_id),
  CONSTRAINT fk_star_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dating_profiles (
  user_id BIGINT PRIMARY KEY,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  dating_bio VARCHAR(260) NOT NULL DEFAULT '',
  looking_for VARCHAR(120) NOT NULL DEFAULT 'آشنایی جدی و گفت‌وگوی عمیق',
  min_age INT NOT NULL DEFAULT 18,
  max_age INT NOT NULL DEFAULT 45,
  gender_pref VARCHAR(16) NOT NULL DEFAULT 'all',
  show_city TINYINT(1) NOT NULL DEFAULT 1,
  activated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dating_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blind_dates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_a BIGINT NOT NULL,
  user_b BIGINT NOT NULL,
  alias_a VARCHAR(60) NOT NULL,
  alias_b VARCHAR(60) NOT NULL,
  status ENUM('active', 'revealed', 'ended') NOT NULL DEFAULT 'active',
  reveal_a TINYINT(1) NOT NULL DEFAULT 0,
  reveal_b TINYINT(1) NOT NULL DEFAULT 0,
  messages_json JSON NOT NULL,
  prompt_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_taste_signals (
  user_id BIGINT PRIMARY KEY,
  preferred_cities_json JSON NOT NULL,
  preferred_interests_json JSON NOT NULL,
  swipe_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_taste_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS adult_verifications (
  user_id BIGINT PRIMARY KEY,
  status ENUM('unverified', 'pending_review', 'verified', 'rejected') NOT NULL DEFAULT 'unverified',
  phone_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  consent_accepted TINYINT(1) NOT NULL DEFAULT 0,
  consent_version VARCHAR(40) NOT NULL DEFAULT 'v1-consent-charter',
  verification_note VARCHAR(255) DEFAULT '',
  reviewed_by VARCHAR(60),
  reviewed_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_adult_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS telegram_groups (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chat_id VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(120) NOT NULL,
  owner_user_id BIGINT NULL,
  anti_link TINYINT(1) NOT NULL DEFAULT 1,
  anti_spam TINYINT(1) NOT NULL DEFAULT 1,
  anti_flood TINYINT(1) NOT NULL DEFAULT 1,
  anti_ads TINYINT(1) NOT NULL DEFAULT 1,
  anti_tabchi TINYINT(1) NOT NULL DEFAULT 1,
  lock_media TINYINT(1) NOT NULL DEFAULT 0,
  sensitivity_level VARCHAR(16) NOT NULL DEFAULT 'medium',
  mute_duration_minutes INT NOT NULL DEFAULT 15,
  banned_words_json JSON NOT NULL,
  welcome_message TEXT NOT NULL,
  rules_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS telegram_group_admins (
  chat_id VARCHAR(64) NOT NULL,
  telegram_id VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'administrator',
  verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, telegram_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS engine_rooms (
  room_code VARCHAR(24) PRIMARY KEY,
  game_type ENUM('hokm', 'mafia', 'truth_dare', 'quiz') NOT NULL,
  host_user_id BIGINT NOT NULL,
  hangout_code VARCHAR(24),
  status ENUM('waiting', 'active', 'finished') NOT NULL DEFAULT 'active',
  state_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_rooms (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_code VARCHAR(24) NOT NULL UNIQUE,
  game_type ENUM('mafia', 'hokm', 'quiz', 'truth_dare') NOT NULL,
  host_user_id BIGINT NULL,
  group_chat_id VARCHAR(64) DEFAULT '',
  phase VARCHAR(32) NOT NULL DEFAULT 'LOBBY',
  day_number INT NOT NULL DEFAULT 1,
  players_json JSON NOT NULL,
  votes_json JSON NOT NULL,
  channel_log_json JSON NOT NULL,
  status ENUM('active', 'finished') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_game_rooms_code (room_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
