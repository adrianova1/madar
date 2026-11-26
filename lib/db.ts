import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { RICH_TRUTH_DARE_PROMPTS } from './truth-dare-prompts';

const CUSTOM_DB_PATH = process.env.DATABASE_PATH?.trim();
const DB_PATH = CUSTOM_DB_PATH ? path.resolve(CUSTOM_DB_PATH) : path.join(process.cwd(), 'data', 'madar.db');
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

declare global {
  var __madarDb: Database.Database | undefined;
}

function createDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  seedInitialData(db);
  return db;
}

export function getDb(): Database.Database {
  if (!globalThis.__madarDb) {
    globalThis.__madarDb = createDb();
  }
  return globalThis.__madarDb;
}

function hashSeedPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      phone TEXT,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'user',
      subscription_tier TEXT NOT NULL DEFAULT 'free',
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      is_banned INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      referral_code TEXT UNIQUE NOT NULL,
      referred_by_user_id INTEGER,
      anon_slug TEXT UNIQUE NOT NULL,
      allow_whispers INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (referred_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY,
      avatar_color TEXT NOT NULL DEFAULT '#1e293b',
      avatar_initials TEXT NOT NULL DEFAULT 'مد',
      gender TEXT NOT NULL DEFAULT 'unspecified',
      birth_date TEXT,
      city TEXT NOT NULL DEFAULT 'تهران',
      province TEXT NOT NULL DEFAULT 'تهران',
      cultural_bg TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      interests TEXT NOT NULL DEFAULT '[]',
      hobbies TEXT NOT NULL DEFAULT '[]',
      relationship_status TEXT DEFAULT 'مجرد',
      goal TEXT DEFAULT 'دوستی و گفت‌وگو',
      preferred_connection TEXT DEFAULT 'گفت‌وگوی صمیمی',
      favorite_planet TEXT DEFAULT 'earth',
      equipped_frame TEXT DEFAULT 'none',
      equipped_badge TEXT DEFAULT 'none',
      hide_city INTEGER NOT NULL DEFAULT 0,
      hide_online INTEGER NOT NULL DEFAULT 0,
      dating_enabled INTEGER NOT NULL DEFAULT 1,
      dating_min_age INTEGER NOT NULL DEFAULT 18,
      dating_max_age INTEGER NOT NULL DEFAULT 45,
      dating_gender_pref TEXT NOT NULL DEFAULT 'all',
      use_personality_in_matching INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      device_label TEXT NOT NULL DEFAULT 'وب / مینی‌اپ',
      ip_address TEXT DEFAULT 'unknown',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS phone_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      phone TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS personality_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      dimension_key TEXT NOT NULL,
      question_id TEXT NOT NULL,
      answer_value INTEGER NOT NULL,
      answer_label TEXT NOT NULL,
      include_in_matching INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, question_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('like', 'pass', 'favorite', 'intro')),
      intro_note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_user_id, to_user_id),
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a_id INTEGER NOT NULL,
      user_b_id INTEGER NOT NULL,
      compatibility_score INTEGER NOT NULL DEFAULT 75,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'unmatched')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_a_id, user_b_id),
      FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(blocker_id, blocked_id),
      FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS whispers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_user_id INTEGER NOT NULL,
      sender_user_id INTEGER,
      sender_alias TEXT NOT NULL DEFAULT 'ناشناس مداری',
      message TEXT NOT NULL,
      reply_text TEXT,
      two_way_accepted INTEGER NOT NULL DEFAULT 0,
      is_blocked INTEGER NOT NULL DEFAULT 0,
      is_reported INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'mini_app',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      replied_at TEXT,
      FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS star_wallets (
      user_id INTEGER PRIMARY KEY,
      free_stars INTEGER NOT NULL DEFAULT 120 CHECK(free_stars >= 0),
      paid_stars INTEGER NOT NULL DEFAULT 0 CHECK(paid_stars >= 0),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS star_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      star_bucket TEXT NOT NULL DEFAULT 'free' CHECK(star_bucket IN ('free', 'paid')),
      tx_type TEXT NOT NULL,
      description TEXT NOT NULL,
      reference_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shop_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      price_stars INTEGER NOT NULL,
      preview_accent TEXT NOT NULL DEFAULT '#eab308',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS user_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES shop_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_missions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      reward_stars INTEGER NOT NULL,
      action_target TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      mission_id TEXT NOT NULL,
      mission_date TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, mission_id, mission_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES daily_missions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS referral_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id INTEGER NOT NULL,
      referred_user_id INTEGER UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'verified',
      reward_stars INTEGER NOT NULL DEFAULT 50,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      question TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_index INTEGER NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'متوسط',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS truth_dare_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL CHECK(mode IN ('truth', 'dare')),
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      is_adult INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game_type TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      result TEXT NOT NULL,
      stars_earned INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS telegram_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      member_count INTEGER NOT NULL DEFAULT 42,
      bot_is_admin INTEGER NOT NULL DEFAULT 1,
      anti_link INTEGER NOT NULL DEFAULT 1,
      anti_ads INTEGER NOT NULL DEFAULT 1,
      anti_spam INTEGER NOT NULL DEFAULT 1,
      anti_flood INTEGER NOT NULL DEFAULT 1,
      lock_media INTEGER NOT NULL DEFAULT 0,
      banned_words TEXT NOT NULL DEFAULT 'تبلیغ،کلاهبرداری،لینک‌دونی',
      welcome_text TEXT NOT NULL DEFAULT 'خوش آمدی به گروه! قوانین را با دستور /rules ببین.',
      rules_text TEXT NOT NULL DEFAULT '۱. احترام متقابل الزامی است.\n۲. ارسال لینک و تبلیغات ممنوع است.\n۳. اسپم و پیام‌های تکراری باعث سکوت موقت می‌شود.',
      ai_enabled INTEGER NOT NULL DEFAULT 1,
      ai_humor_level TEXT NOT NULL DEFAULT 'متعادل',
      ai_max_reply_chars INTEGER NOT NULL DEFAULT 400,
      ai_daily_limit INTEGER NOT NULL DEFAULT 100,
      ai_used_today INTEGER NOT NULL DEFAULT 0,
      ai_allowed_topics TEXT NOT NULL DEFAULT 'عمومی،بازی،سرگرمی،اطلاعات عمومی',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS moderation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      command TEXT NOT NULL,
      target_label TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor_label TEXT NOT NULL DEFAULT 'ربات مدار',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      group_id INTEGER,
      model TEXT NOT NULL,
      prompt_chars INTEGER NOT NULL,
      response_chars INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_credentials (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      username TEXT NOT NULL DEFAULT 'superadmin',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Super Admin',
      claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT NOT NULL,
      admin_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      details TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dating_profiles (
      user_id INTEGER PRIMARY KEY,
      is_active INTEGER NOT NULL DEFAULT 1,
      dating_bio TEXT NOT NULL DEFAULT '',
      looking_for TEXT NOT NULL DEFAULT 'آشنایی جدی و گفت‌وگوی عمیق',
      min_age INTEGER NOT NULL DEFAULT 18,
      max_age INTEGER NOT NULL DEFAULT 45,
      gender_pref TEXT NOT NULL DEFAULT 'all',
      show_city INTEGER NOT NULL DEFAULT 1,
      activated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adult_verifications (
      user_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'unverified' CHECK(status IN ('unverified', 'pending_review', 'verified', 'rejected')),
      phone_confirmed INTEGER NOT NULL DEFAULT 0,
      consent_accepted INTEGER NOT NULL DEFAULT 0,
      consent_version TEXT NOT NULL DEFAULT 'v1-consent-charter',
      verification_note TEXT DEFAULT '',
      reviewed_by TEXT,
      reviewed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS game_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT UNIQUE NOT NULL,
      game_type TEXT NOT NULL CHECK(game_type IN ('mafia', 'hokm', 'quiz', 'truth_dare')),
      host_user_id INTEGER,
      group_chat_id TEXT DEFAULT '',
      phase TEXT NOT NULL DEFAULT 'LOBBY',
      day_number INTEGER NOT NULL DEFAULT 1,
      players_json TEXT NOT NULL DEFAULT '[]',
      votes_json TEXT NOT NULL DEFAULT '{}',
      channel_log_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'finished')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS engine_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code TEXT UNIQUE NOT NULL,
      game_type TEXT NOT NULL CHECK(game_type IN ('hokm', 'mafia', 'quiz', 'truth_dare')),
      is_hangout INTEGER NOT NULL DEFAULT 0,
      host_user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'lobby' CHECK(status IN ('lobby', 'playing', 'finished')),
      state_json TEXT NOT NULL DEFAULT '{}',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS user_taste_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      target_user_id INTEGER NOT NULL,
      signal_type TEXT NOT NULL CHECK(signal_type IN ('like', 'superlike', 'pass', 'favorite', 'intro', 'chat_continue')),
      weight REAL NOT NULL DEFAULT 1.0,
      target_interests_json TEXT NOT NULL DEFAULT '[]',
      target_goal TEXT DEFAULT '',
      target_city TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blind_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_code TEXT UNIQUE NOT NULL,
      user_a_id INTEGER NOT NULL,
      user_b_id INTEGER NOT NULL,
      alias_a TEXT NOT NULL,
      alias_b TEXT NOT NULL,
      compatibility_score INTEGER NOT NULL DEFAULT 82,
      shared_traits_json TEXT NOT NULL DEFAULT '[]',
      qa_state_json TEXT NOT NULL DEFAULT '[]',
      user_a_reveal INTEGER NOT NULL DEFAULT 0,
      user_b_reveal INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revealed', 'ended')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blind_date_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blind_date_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      msg_type TEXT NOT NULL DEFAULT 'text' CHECK(msg_type IN ('text', 'reaction', 'qa_answer', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (blind_date_id) REFERENCES blind_dates(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS telegram_group_admins (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      telegram_status TEXT NOT NULL DEFAULT 'administrator',
      verified_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_likes_to ON likes(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_whispers_recipient ON whispers(recipient_user_id);
    CREATE INDEX IF NOT EXISTS idx_star_tx_user ON star_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_game_rooms_code ON game_rooms(room_code);
    CREATE INDEX IF NOT EXISTS idx_engine_rooms_code ON engine_rooms(room_code);
    CREATE INDEX IF NOT EXISTS idx_taste_user ON user_taste_signals(user_id);
    CREATE INDEX IF NOT EXISTS idx_blind_dates_users ON blind_dates(user_a_id, user_b_id);
  `);

  // Safe additive column migrations for users (preserves all existing users & MADAR data)
  const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  const hasUserCol = (col: string) => userCols.some((c) => c.name === col);
  if (!hasUserCol('telegram_first_name')) db.exec('ALTER TABLE users ADD COLUMN telegram_first_name TEXT');
  if (!hasUserCol('telegram_last_name')) db.exec('ALTER TABLE users ADD COLUMN telegram_last_name TEXT');
  if (!hasUserCol('telegram_username')) db.exec('ALTER TABLE users ADD COLUMN telegram_username TEXT');
  if (!hasUserCol('telegram_photo_url')) db.exec('ALTER TABLE users ADD COLUMN telegram_photo_url TEXT');
  if (!hasUserCol('telegram_language_code')) db.exec('ALTER TABLE users ADD COLUMN telegram_language_code TEXT');
  if (!hasUserCol('last_login_at')) db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
  if (!hasUserCol('onboarding_completed')) {
    db.exec('ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0');
    // Existing users who already had phone_verified = 1 remain completed without re-asking phone
    db.exec('UPDATE users SET onboarding_completed = 1 WHERE phone_verified = 1');
  }
  if (!hasUserCol('channel_verified_at')) db.exec('ALTER TABLE users ADD COLUMN channel_verified_at TEXT');
  if (!hasUserCol('phone_shared_at')) db.exec('ALTER TABLE users ADD COLUMN phone_shared_at TEXT');

  // Ensure default bot/channel/system settings exist without overwriting admin changes
  const ensureSetting = db.prepare('INSERT OR IGNORE INTO system_settings (key, value_json) VALUES (?, ?)');
  ensureSetting.run('forced_channels', JSON.stringify([]));
  ensureSetting.run('delegated_admins', JSON.stringify([]));
  ensureSetting.run(
    'bot_settings',
    JSON.stringify({
      welcomeText: 'به مدار خوش آمدی.',
      requirePhoneContact: true,
      maintenanceMode: false,
    })
  );

  // Safe additive column migrations for telegram_groups (preserves all existing group configs)
  const groupCols = db.prepare('PRAGMA table_info(telegram_groups)').all() as { name: string }[];
  const hasCol = (col: string) => groupCols.some((c) => c.name === col);
  if (!hasCol('owner_user_id')) {
    db.exec('ALTER TABLE telegram_groups ADD COLUMN owner_user_id INTEGER');
  }
  if (!hasCol('sensitivity_level')) {
    db.exec("ALTER TABLE telegram_groups ADD COLUMN sensitivity_level TEXT NOT NULL DEFAULT 'medium'");
  }
  if (!hasCol('anti_tabchi')) {
    db.exec('ALTER TABLE telegram_groups ADD COLUMN anti_tabchi INTEGER NOT NULL DEFAULT 1');
  }
  if (!hasCol('mute_duration_minutes')) {
    db.exec('ALTER TABLE telegram_groups ADD COLUMN mute_duration_minutes INTEGER NOT NULL DEFAULT 10');
  }

  // Sync rich human Persian Truth or Dare prompt library (116+ distinct items across 6 categories)
  const syncPromptsTx = db.transaction(() => {
    const checkExists = db.prepare('SELECT id FROM truth_dare_prompts WHERE mode = ? AND text = ?');
    const insPrompt = db.prepare('INSERT INTO truth_dare_prompts (mode, category, text, is_adult) VALUES (?, ?, ?, ?)');
    for (const p of RICH_TRUTH_DARE_PROMPTS) {
      if (!checkExists.get(p.mode, p.text)) {
        insPrompt.run(p.mode, p.category, p.text, p.isAdult);
      }
    }
  });
  syncPromptsTx();

  // Safe migration for existing seeded community users: ensure dating_profiles & constellation referrals exist
  const dpCount = (db.prepare('SELECT COUNT(*) as c FROM dating_profiles').get() as { c: number }).c;
  if (dpCount === 0) {
    const existingUsers = db
      .prepare(`
        SELECT u.id, u.username, p.bio, p.goal, p.hide_city, p.dating_enabled
        FROM users u
        JOIN user_profiles p ON p.user_id = u.id
        WHERE u.is_deleted = 0
      `)
      .all() as { id: number; username: string; bio: string; goal: string; hide_city: number; dating_enabled: number }[];

    const insertDp = db.prepare(`
      INSERT OR IGNORE INTO dating_profiles (user_id, is_active, dating_bio, looking_for, show_city)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const u of existingUsers) {
      if (u.dating_enabled) {
        insertDp.run(u.id, 1, u.bio || '', u.goal || 'دوستی و گفت‌وگو', u.hide_city ? 0 : 1);
      }
    }

    // Seed verified constellation referrals for parham_sky so the personal galaxy showcases invited orbiting friends
    const parham = existingUsers.find((u) => u.username === 'parham_sky');
    const kian = existingUsers.find((u) => u.username === 'kian_dev');
    const sara = existingUsers.find((u) => u.username === 'sara_melody');
    if (parham && kian) {
      db.prepare(
        "INSERT OR IGNORE INTO referral_events (referrer_user_id, referred_user_id, status, reward_stars) VALUES (?, ?, 'verified', 50)"
      ).run(parham.id, kian.id);
    }
    if (parham && sara) {
      db.prepare(
        "INSERT OR IGNORE INTO referral_events (referrer_user_id, referred_user_id, status, reward_stars) VALUES (?, ?, 'verified', 50)"
      ).run(parham.id, sara.id);
    }
  }
}

function seedInitialData(db: Database.Database) {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount > 0) return;

  const seed = db.transaction(() => {
    // 1. Default planets config & system settings
    const defaultPlanets = [
      { id: 'earth', name: 'زمین', subtitle: 'پروفایل و کشف جهان', target: 'profile', color: '#38bdf8', image: '/images/madar/earth.jpg' },
      { id: 'venus', name: 'ونوس', subtitle: 'آشنایی و سازگاری هوشمند', target: 'venus', color: '#fb7185', image: '/images/madar/venus.jpg' },
      { id: 'mars', name: 'مریخ', subtitle: 'جرئت و حقیقت هیجانی', target: 'games:truth', color: '#f97316', image: '' },
      { id: 'jupiter', name: 'مشتری', subtitle: 'مافیا و حکم گروهی', target: 'games:hokm', color: '#eab308', image: '/images/madar/jupiter.jpg' },
      { id: 'neptune', name: 'نپتون', subtitle: 'نجوا و پیام ناشناس', target: 'whisper', color: '#22d3ee', image: '/images/madar/neptune.jpg' },
      { id: 'mercury', name: 'عطارد', subtitle: 'کوییز و لیگ دانش', target: 'games:quiz', color: '#a78bfa', image: '' },
      { id: 'saturn', name: 'زحل', subtitle: 'مدیریت محلی و ضداسپم گروه', target: 'saturn', color: '#f59e0b', image: '' },
    ];

    db.prepare('INSERT OR REPLACE INTO system_settings (key, value_json) VALUES (?, ?)').run(
      'planets',
      JSON.stringify(defaultPlanets)
    );
    db.prepare('INSERT OR REPLACE INTO system_settings (key, value_json) VALUES (?, ?)').run(
      'economy',
      JSON.stringify({
        referralRewardStars: 50,
        dailyCheckinStars: 15,
        botWelcomeText: 'سلام! به مدار خوش آمدی.\nاینجا جهانی از آدم‌ها، بازی‌ها و ارتباطات منتظر توست.',
        aiGlobalDailyCap: 1000,
      })
    );

    // 2. Seed Shop Items
    const shopItems = [
      { id: 'frame_gold_orbit', title: 'قاب مدار طلایی', description: 'حلقه طلایی نجومی دور آواتار پروفایل', category: 'قاب پروفایل', price_stars: 80, preview_accent: '#eab308' },
      { id: 'frame_neptune_halo', title: 'هاله آبی نپتون', description: 'نور حاشیه‌ای آبی یخی مخصوص نجواگران', category: 'قاب پروفایل', price_stars: 65, preview_accent: '#38bdf8' },
      { id: 'badge_astronaut', title: 'نشان کاوشگر کهکشان', description: 'نشان ویژه نمایش‌داده‌شده کنار نام کاربری', category: 'نشان ویژه', price_stars: 50, preview_accent: '#a78bfa' },
      { id: 'badge_hakem', title: 'نشان حاکم اعظم', description: 'نشان افتخار برای بازیکنان حرفه‌ای حکم و مافیا', category: 'نشان ویژه', price_stars: 95, preview_accent: '#f59e0b' },
      { id: 'planet_theme_aurora', title: 'شخصی‌سازی سیاره شفق', description: 'نورپردازی شفق قطبی برای مدار اختصاصی تو', category: 'شخصی‌سازی سیاره', price_stars: 140, preview_accent: '#34d399' },
      { id: 'sub_plus_30d', title: 'اشتراک مدار پلاس (۳۰ روز)', description: 'فیلترهای پیشرفته ونوس، اولویت نمایش و ۵۰ ستاره هدیه', category: 'اشتراک ویژه', price_stars: 250, preview_accent: '#fb7185' },
    ];
    const insertShop = db.prepare(
      'INSERT INTO shop_items (id, title, description, category, price_stars, preview_accent) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const item of shopItems) {
      insertShop.run(item.id, item.title, item.description, item.category, item.price_stars, item.preview_accent);
    }

    // 3. Seed Daily Missions
    const missions = [
      { id: 'daily_checkin', title: 'حضور روزانه در مدار', description: 'ثبت ورود امروز در منظومه مدار', reward_stars: 15, action_target: 'home' },
      { id: 'complete_quiz', title: 'چالش عطارد', description: 'شرکت در یک دور مسابقه اطلاعات عمومی', reward_stars: 25, action_target: 'games:quiz' },
      { id: 'send_whisper', title: 'ارسال یک نجوا', description: 'ارسال یک پیام محترمانه ناشناس در نپتون', reward_stars: 20, action_target: 'whisper' },
      { id: 'personality_step', title: 'شناخت عمیق‌تر', description: 'تکمیل یا به‌روزرسانی آزمون سبک ارتباطی', reward_stars: 30, action_target: 'profile' },
    ];
    const insertMission = db.prepare(
      'INSERT INTO daily_missions (id, title, description, reward_stars, action_target) VALUES (?, ?, ?, ?, ?)'
    );
    for (const m of missions) {
      insertMission.run(m.id, m.title, m.description, m.reward_stars, m.action_target);
    }

    // 4. Seed Community Users for realistic matching, leaderboard, and whispers
    const seedUsers = [
      {
        telegram_id: '100001',
        username: 'parham_sky',
        display_name: 'پرهام شریفی',
        phone: '+989121112233',
        gender: 'مرد',
        birth_date: '1997-05-14',
        city: 'تهران',
        province: 'تهران',
        bio: 'عاشق نجوم، بازی مافیا، سینمای کلاسیک و کافه‌گردی‌های آخر هفته.',
        interests: ['نجوم', 'مافیا', 'سینما', 'موسیقی بی‌کلام', 'کوهنوردی'],
        goal: 'آشنایی جدی و گفت‌وگوی عمیق',
        avatar_initials: 'پش',
        avatar_color: '#1e3a5f',
        stars: 240,
        level: 4,
        xp: 480,
        tier: 'plus',
        referral_code: 'ref_parham01',
        anon_slug: 'parham_sky',
        answers: [
          ['communication', 'q1', 4, 'گفت‌وگوی مستقیم و آرام'],
          ['extroversion', 'q2', 3, 'میان‌گرا (بسته به جمع)'],
          ['affection', 'q3', 5, 'توجه به جزئیات و زمان باکیفیت'],
          ['conflict', 'q4', 4, 'گفت‌وگوی منطقی پس از کمی مکث'],
          ['adventure', 'q5', 4, 'علاقه‌مند به تجربه‌های تازه'],
          ['independence', 'q6', 3, 'تعادل میان استقلال و صمیمیت'],
        ],
      },
      {
        telegram_id: '100002',
        username: 'niloofar_art',
        display_name: 'نیلوفر راد',
        phone: '+989123334455',
        gender: 'زن',
        birth_date: '1999-08-21',
        city: 'تهران',
        province: 'تهران',
        bio: 'طراح گرافیک و عکاس شب. طرفدار کتاب، قهوه دمی و بازی حکم آخر شب.',
        interests: ['طراحی', 'عکاسی', 'سینما', 'حکم', 'قهوه'],
        goal: 'آشنایی جدی و گفت‌وگوی عمیق',
        avatar_initials: 'نر',
        avatar_color: '#4c1d3d',
        stars: 310,
        level: 5,
        xp: 620,
        tier: 'vip',
        referral_code: 'ref_niloofar',
        anon_slug: 'niloofar_art',
        answers: [
          ['communication', 'q1', 4, 'گفت‌وگوی مستقیم و آرام'],
          ['extroversion', 'q2', 3, 'میان‌گرا (بسته به جمع)'],
          ['affection', 'q3', 5, 'توجه به جزئیات و زمان باکیفیت'],
          ['conflict', 'q4', 5, 'حل مسئله با همدلی'],
          ['adventure', 'q5', 4, 'علاقه‌مند به تجربه‌های تازه'],
          ['independence', 'q6', 3, 'تعادل میان استقلال و صمیمیت'],
        ],
      },
      {
        telegram_id: '100003',
        username: 'sara_melody',
        display_name: 'سارا کاظمی',
        phone: '+989135556677',
        gender: 'زن',
        birth_date: '1998-02-10',
        city: 'اصفهان',
        province: 'اصفهان',
        bio: 'نوازنده پیانو و عاشق کوییزهای موسیقی و سفرهای جاده‌ای.',
        interests: ['موسیقی', 'سفر', 'کوییز', 'کتاب', 'کافه'],
        goal: 'دوستی و کشف آدم‌های هم‌فکر',
        avatar_initials: 'سک',
        avatar_color: '#1e3a4c',
        stars: 195,
        level: 3,
        xp: 340,
        tier: 'free',
        referral_code: 'ref_sara98',
        anon_slug: 'sara_melody',
        answers: [
          ['communication', 'q1', 5, 'صمیمی و پرحرارت'],
          ['extroversion', 'q2', 4, 'برون‌گرا و اجتماعی'],
          ['affection', 'q3', 4, 'کلمات محبت‌آمیز و تشویق'],
          ['conflict', 'q4', 4, 'گفت‌وگوی منطقی پس از کمی مکث'],
          ['adventure', 'q5', 5, 'ماجراجو و اهل تغییر'],
          ['independence', 'q6', 4, 'علاقه‌مند به همراهی نزدیک'],
        ],
      },
      {
        telegram_id: '100004',
        username: 'kian_dev',
        display_name: 'کیان مهرآذر',
        phone: '+989177778899',
        gender: 'مرد',
        birth_date: '1996-11-03',
        city: 'شیراز',
        province: 'فارس',
        bio: 'مهندس نرم‌افزار، شطرنج‌باز و عاشق مافیا با سناریوهای پیچیده.',
        interests: ['تکنولوژی', 'مافیا', 'شطرنج', 'نجوم', 'کوهنوردی'],
        goal: 'دوستی و بازی‌های گروهی',
        avatar_initials: 'کم',
        avatar_color: '#1d2d50',
        stars: 280,
        level: 4,
        xp: 510,
        tier: 'plus',
        referral_code: 'ref_kiandev',
        anon_slug: 'kian_dev',
        answers: [
          ['communication', 'q1', 4, 'گفت‌وگوی مستقیم و آرام'],
          ['extroversion', 'q2', 2, 'درون‌گرا و شنونده خوب'],
          ['affection', 'q3', 3, 'حمایت عملی و همراهی'],
          ['conflict', 'q4', 4, 'گفت‌وگوی منطقی پس از کمی مکث'],
          ['adventure', 'q5', 3, 'متعادل بین امنیت و هیجان'],
          ['independence', 'q6', 2, 'نیازمند فضای شخصی کافی'],
        ],
      },
      {
        telegram_id: '100005',
        username: 'tara_cosmos',
        display_name: 'تارا فرهادی',
        phone: '+989159990011',
        gender: 'زن',
        birth_date: '2000-04-18',
        city: 'تهران',
        province: 'تهران',
        bio: 'دانشجوی معماری، علاقه‌مند به هنر مدرن، پادل و گپ‌های صمیمی شبانه.',
        interests: ['معماری', 'ورزش', 'سینما', 'سفر', 'نجوم'],
        goal: 'آشنایی جدی و گفت‌وگوی عمیق',
        avatar_initials: 'تف',
        avatar_color: '#3b1d5a',
        stars: 215,
        level: 3,
        xp: 390,
        tier: 'free',
        referral_code: 'ref_tarac',
        anon_slug: 'tara_cosmos',
        answers: [
          ['communication', 'q1', 4, 'گفت‌وگوی مستقیم و آرام'],
          ['extroversion', 'q2', 4, 'برون‌گرا و اجتماعی'],
          ['affection', 'q3', 5, 'توجه به جزئیات و زمان باکیفیت'],
          ['conflict', 'q4', 4, 'گفت‌وگوی منطقی پس از کمی مکث'],
          ['adventure', 'q5', 4, 'علاقه‌مند به تجربه‌های تازه'],
          ['independence', 'q6', 3, 'تعادل میان استقلال و صمیمیت'],
        ],
      },
      {
        telegram_id: '100006',
        username: 'arman_cinema',
        display_name: 'آرمان یوسفی',
        phone: '+989112223344',
        gender: 'مرد',
        birth_date: '1995-09-27',
        city: 'رشت',
        province: 'گیلان',
        bio: 'پادکستر و تدوینگر. عاشق باران، سینما، حکم چهارنفره و گفت‌وگوهای بی‌پرده.',
        interests: ['سینما', 'پادکست', 'حکم', 'قهوه', 'موسیقی'],
        goal: 'دوستی و کشف آدم‌های هم‌فکر',
        avatar_initials: 'آی',
        avatar_color: '#1b3b36',
        stars: 175,
        level: 3,
        xp: 290,
        tier: 'free',
        referral_code: 'ref_arman95',
        anon_slug: 'arman_cinema',
        answers: [
          ['communication', 'q1', 5, 'صمیمی و پرحرارت'],
          ['extroversion', 'q2', 4, 'برون‌گرا و اجتماعی'],
          ['affection', 'q3', 4, 'کلمات محبت‌آمیز و تشویق'],
          ['conflict', 'q4', 5, 'حل مسئله با همدلی'],
          ['adventure', 'q5', 4, 'علاقه‌مند به تجربه‌های تازه'],
          ['independence', 'q6', 3, 'تعادل میان استقلال و صمیمیت'],
        ],
      },
    ];

    const insertUser = db.prepare(`
      INSERT INTO users (telegram_id, username, display_name, password_hash, phone, phone_verified, subscription_tier, level, xp, referral_code, anon_slug)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `);
    const insertProfile = db.prepare(`
      INSERT INTO user_profiles (user_id, avatar_color, avatar_initials, gender, birth_date, city, province, bio, interests, goal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertWallet = db.prepare('INSERT INTO star_wallets (user_id, free_stars, paid_stars) VALUES (?, ?, 0)');
    const insertAnswer = db.prepare(
      'INSERT INTO personality_answers (user_id, dimension_key, question_id, answer_value, answer_label) VALUES (?, ?, ?, ?, ?)'
    );

    const createdIds: number[] = [];
    for (const u of seedUsers) {
      const res = insertUser.run(
        u.telegram_id,
        u.username,
        u.display_name,
        hashSeedPassword('MadarDemo#2026'),
        u.phone,
        u.tier,
        u.level,
        u.xp,
        u.referral_code,
        u.anon_slug
      );
      const uid = Number(res.lastInsertRowid);
      createdIds.push(uid);
      insertProfile.run(
        uid,
        u.avatar_color,
        u.avatar_initials,
        u.gender,
        u.birth_date,
        u.city,
        u.province,
        u.bio,
        JSON.stringify(u.interests),
        u.goal
      );
      insertWallet.run(uid, u.stars);
      for (const a of u.answers) {
        insertAnswer.run(uid, a[0], a[1], a[2], a[3]);
      }
    }

    // Seed a reciprocal like so the first user gets a live mutual match when they like Niloofar, plus one active whisper
    db.prepare('INSERT INTO likes (from_user_id, to_user_id, action) VALUES (?, ?, ?)').run(createdIds[1], createdIds[0], 'like');
    db.prepare('INSERT INTO likes (from_user_id, to_user_id, action) VALUES (?, ?, ?)').run(createdIds[4], createdIds[0], 'like');

    db.prepare(`
      INSERT INTO whispers (recipient_user_id, sender_user_id, sender_alias, message, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      createdIds[0],
      createdIds[1],
      'ستاره ناشناس',
      'پروفایلت توی مدار خیلی باسلیقه چیده شده! توی بازی مافیا معمولاً نقش مافیا رو بیشتر دوست داری یا کارآگاه؟',
      'mini_app'
    );

    db.prepare(`
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (?, 'welcome', 'خوش آمدی به مدار', 'کیف‌پول ستاره تو فعال شد. از مأموریت‌های روزانه ستاره رایگان بگیر.')
    `).run(createdIds[0]);

    // 5. Seed Persian Quiz Questions
    const quizQuestions = [
      { category: 'اطلاعات عمومی', question: 'کدام سیاره منظومه شمسی بیشترین تعداد قمر شناخته‌شده را دارد؟', options: ['مشتری', 'زحل', 'اورانوس', 'نپتون'], correct: 1, diff: 'متوسط' },
      { category: 'سینما و سریال', question: 'فیلم «جدایی نادر از سیمین» در چه سالی برنده جایزه اسکار بهترین فیلم غیرانگلیسی‌زبان شد؟', options: ['۲۰۱۰', '۲۰۱۲', '۲۰۱۴', '۲۰۱۶'], correct: 1, diff: 'آسان' },
      { category: 'تاریخ', question: 'تخت جمشید (پرسپولیس) به دستور کدام پادشاه هخامنشی بنیان‌گذاری شد؟', options: ['کوروش بزرگ', 'داریوش بزرگ', 'خشایارشا', 'اردشیر یکم'], correct: 1, diff: 'آسان' },
      { category: 'تکنولوژی', question: 'کدام پروتکل برای رمزنگاری امن ارتباطات وب روی لایه انتقال استفاده می‌شود؟', options: ['FTP', 'TLS', 'SMTP', 'ICMP'], correct: 1, diff: 'متوسط' },
      { category: 'جغرافیا', question: 'بلندترین قله ایران کدام است و در کدام رشته‌کوه قرار دارد؟', options: ['سبلان - البرز', 'دماوند - البرز', 'دنا - زاگرس', 'علم‌کوه - البرز'], correct: 1, diff: 'آسان' },
      { category: 'اطلاعات علمی', question: 'نور خورشید تقریباً در چه مدت زمانی به زمین می‌رسد؟', options: ['۲ دقیقه و ۳۰ ثانیه', '۸ دقیقه و ۲۰ ثانیه', '۱۵ دقیقه', '۴۵ ثانیه'], correct: 1, diff: 'آسان' },
      { category: 'موسیقی', question: 'ساز «تار» در موسیقی سنتی ایران چند سیم دارد؟', options: ['۴ سیم', '۶ سیم', '۸ سیم', '۵ سیم'], correct: 1, diff: 'متوسط' },
      { category: 'ورزش', question: 'تیم ملی فوتبال ایران برای نخستین بار در کدام جام جهانی شرکت کرد؟', options: ['۱۹۷۴ آلمان', '۱۹۷۸ آرژانتین', '۱۹۹۸ فرانسه', '۱۹۸۲ اسپانیا'], correct: 1, diff: 'متوسط' },
      { category: 'هوش و منطق', question: 'اگر ۵ ماشین در ۵ دقیقه ۵ قطعه بسازند، ۱۰۰ ماشین در چند دقیقه ۱۰۰ قطعه می‌سازند؟', options: ['۱۰۰ دقیقه', '۵ دقیقه', '۲۰ دقیقه', '۱ دقیقه'], correct: 1, diff: 'چالشی' },
      { category: 'فرهنگ عمومی', question: 'شاهنامه فردوسی تقریباً چند بیت دارد؟', options: ['حدود ۲۰ هزار بیت', 'حدود ۵۰ هزار بیت', 'حدود ۸۰ هزار بیت', 'حدود ۱۰ هزار بیت'], correct: 1, diff: 'متوسط' },
      { category: 'دانستنی‌های عجیب', question: 'کدام جانور سه قلب و خون آبی‌رنگ دارد؟', options: ['نهنگ آبی', 'هشت‌پا', 'عقاب طلایی', 'اسب دریایی'], correct: 1, diff: 'آسان' },
      { category: 'اطلاعات علمی', question: 'عنصر شیمیایی با نماد Au چیست؟', options: ['نقره', 'طلا', 'آرگون', 'آلومینیوم'], correct: 1, diff: 'آسان' },
    ];
    const insertQuiz = db.prepare(
      'INSERT INTO quiz_questions (category, question, options_json, correct_index, difficulty) VALUES (?, ?, ?, ?, ?)'
    );
    for (const q of quizQuestions) {
      insertQuiz.run(q.category, q.question, JSON.stringify(q.options), q.correct, q.diff);
    }

    // 6. Seed Truth or Dare Prompts (Normal + Consent-based 18+)
    const tdPrompts = [
      { mode: 'truth', category: 'دوستانه', text: 'عجیب‌ترین عادت روزمره‌ای که کمتر کسی درباره تو می‌داند چیست؟', adult: 0 },
      { mode: 'truth', category: 'خنده‌دار', text: 'سوتی‌بزرگی که در یک جمع رسمی دادی و هنوز یادت می‌افتد خنده‌ات می‌گیرد چیست؟', adult: 0 },
      { mode: 'truth', category: 'چالشی', text: 'اگر می‌توانستی یک تصمیم بزرگ پنج سال گذشته‌ات را عوض کنی، کدام تصمیم بود؟', adult: 0 },
      { mode: 'truth', category: 'احساسی', text: 'مهم‌ترین ویژگی که باعث می‌شود به یک نفر عمیقاً اعتماد کنی چیست؟', adult: 0 },
      { mode: 'truth', category: 'عاشقانه', text: 'بهترین و به‌یادماندنی‌ترین قرار اولی که تصور می‌کنی چگونه است؟', adult: 0 },
      { mode: 'truth', category: 'هیجان‌انگیز', text: 'جسورانه‌ترین کاری که دوست داری قبل از ۴۰ سالگی حتماً تجربه کنی چیست؟', adult: 0 },
      { mode: 'truth', category: 'بزرگسالان ۱۸+', text: 'در یک رابطه عاطفی بالغانه، کدام مرز شخصی برایت خط قرمز و غیرقابل مذاکره است؟ (پاسخ اختیاری است)', adult: 1 },
      { mode: 'truth', category: 'بزرگسالان ۱۸+', text: 'صادقانه‌ترین انتظاری که از صمیمیت عاطفی در رابطه بلندمدت داری چیست؟ (پاسخ اختیاری است)', adult: 1 },
      { mode: 'dare', category: 'دوستانه', text: 'یک تعریف واقعی و مشخص درباره یکی از بازیکنان حاضر در اتاق بگو.', adult: 0 },
      { mode: 'dare', category: 'خنده‌دار', text: 'تا نوبت بعدی‌ات تمام جمله‌هایت را با لحن گوینده اخبار ساعت ۲۱ بیان کن.', adult: 0 },
      { mode: 'dare', category: 'چالشی', text: 'آخرین یادداشت یا متن کوتاه غیرشخصی که ذخیره کردی را برای جمع تعریف کن.', adult: 0 },
      { mode: 'dare', category: 'عاشقانه', text: 'در ۳۰ ثانیه یک جمله شاعرانه بداهه درباره شب و ستاره‌ها بساز.', adult: 0 },
      { mode: 'dare', category: 'هیجان‌انگیز', text: 'چالش ۶۰ ثانیه: بدون استفاده از کلمات «من»، «آره» و «نه» به سه سؤال جمع پاسخ بده.', adult: 0 },
      { mode: 'dare', category: 'بزرگسالان ۱۸+', text: 'با رضایت کامل، یک جمله صادقانه درباره جذاب‌ترین ویژگی شخصیتی در نگاه اول بگو یا نوبت را رد کن.', adult: 1 },
    ];
    const insertTd = db.prepare(
      'INSERT INTO truth_dare_prompts (mode, category, text, is_adult) VALUES (?, ?, ?, ?)'
    );
    for (const p of tdPrompts) {
      insertTd.run(p.mode, p.category, p.text, p.adult);
    }

    // 7. Seed Telegram Group for Saturn Local Moderation Engine
    const grpRes = db.prepare(`
      INSERT INTO telegram_groups (chat_id, title, member_count, bot_is_admin, anti_link, anti_ads, anti_spam, anti_flood, lock_media)
      VALUES ('-10024891023', 'کهکشان دوستان مدار', 186, 1, 1, 1, 1, 1, 0)
    `).run();
    const grpId = Number(grpRes.lastInsertRowid);
    db.prepare(`
      INSERT INTO moderation_logs (group_id, command, target_label, reason, actor_label)
      VALUES (?, '/clean', 'پیام تبلیغاتی', 'شناسایی لینک دعوت غیرمجاز توسط ضدلینک خودکار', 'محافظ زحل مدار')
    `).run(grpId);
  });

  seed();
}

export function adjustStarsAtomic(
  userId: number,
  delta: number,
  bucket: 'free' | 'paid',
  txType: string,
  description: string,
  referenceId?: string
): { free_stars: number; paid_stars: number; total: number } {
  const db = getDb();
  const tx = db.transaction(() => {
    const wallet = db
      .prepare('SELECT free_stars, paid_stars FROM star_wallets WHERE user_id = ?')
      .get(userId) as { free_stars: number; paid_stars: number } | undefined;

    if (!wallet) {
      throw new Error('کیف‌پول ستاره یافت نشد');
    }

    let nextFree = wallet.free_stars;
    let nextPaid = wallet.paid_stars;

    if (delta < 0) {
      const cost = Math.abs(delta);
      const total = nextFree + nextPaid;
      if (total < cost) {
        throw new Error('موجودی ستاره کافی نیست');
      }
      // Spend free stars first, then paid stars
      if (nextFree >= cost) {
        nextFree -= cost;
      } else {
        const rem = cost - nextFree;
        nextFree = 0;
        nextPaid -= rem;
      }
    } else {
      if (bucket === 'paid') nextPaid += delta;
      else nextFree += delta;
    }

    db.prepare(
      "UPDATE star_wallets SET free_stars = ?, paid_stars = ?, updated_at = datetime('now') WHERE user_id = ?"
    ).run(nextFree, nextPaid, userId);

    db.prepare(
      'INSERT INTO star_transactions (user_id, amount, star_bucket, tx_type, description, reference_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, delta, bucket, txType, description, referenceId ?? null);

    return { free_stars: nextFree, paid_stars: nextPaid, total: nextFree + nextPaid };
  });

  return tx();
}
