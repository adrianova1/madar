-- MADAR | مدار — MySQL 8 / MariaDB Schema (PostgreSQL-migratable)
-- Deploy in a dedicated database separate from g3pibot.

CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  telegram_id VARCHAR(64) UNIQUE,
  username VARCHAR(40) NOT NULL UNIQUE,
  display_name VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255),
  phone VARCHAR(24),
  phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  subscription_tier VARCHAR(16) NOT NULL DEFAULT 'free',
  level INT NOT NULL DEFAULT 1,
  xp INT NOT NULL DEFAULT 0,
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

