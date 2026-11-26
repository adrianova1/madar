import crypto from 'crypto';
import { getDb, adjustStarsAtomic } from './db';
import { VerifiedTelegramUser, logSystemError } from './security';

export interface ForcedChannelConfig {
  id: string;
  chatId: string; // e.g. "@madarchannel" or "-100123456789"
  title: string;
  inviteUrl: string; // e.g. "https://t.me/madarchannel"
  enabled: boolean;
}

export interface ChannelMembershipResult {
  allJoined: boolean;
  checkedByApi: boolean;
  channels: {
    id: string;
    chatId: string;
    title: string;
    inviteUrl: string;
    joined: boolean;
  }[];
  error?: string;
}

export function getBotUsername(): string {
  return (process.env.TELEGRAM_BOT_USERNAME || 'm4d4rbot').trim().replace(/^@/, '') || 'm4d4rbot';
}

export async function callTelegramBot<T = unknown>(
  method: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, description: 'TELEGRAM_BOT_TOKEN not configured' };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6500),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !json?.ok) {
      return { ok: false, description: json?.description || `HTTP ${res.status}` };
    }
    return { ok: true, result: json.result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Telegram Bot API request failed';
    logSystemError('telegram_bot_api', `${method} failed`, msg);
    return { ok: false, description: msg };
  }
}

export function getForcedChannels(): ForcedChannelConfig[] {
  const db = getDb();
  const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'forced_channels'").get() as
    | { value_json: string }
    | undefined;

  if (row?.value_json) {
    try {
      const parsed = JSON.parse(row.value_json);
      if (Array.isArray(parsed)) {
        return parsed.filter((c) => c && typeof c.chatId === 'string' && c.chatId.trim().length > 0);
      }
    } catch {
      // fallback to env
    }
  }

  const envRaw = process.env.REQUIRED_TELEGRAM_CHANNELS?.trim();
  if (!envRaw) return [];

  try {
    if (envRaw.startsWith('[')) {
      const arr = JSON.parse(envRaw);
      if (Array.isArray(arr)) {
        return arr.map((item, idx) => ({
          id: String(item.id || `env_${idx}`),
          chatId: String(item.chatId || item),
          title: String(item.title || item.chatId || `کانال ${idx + 1}`),
          inviteUrl:
            String(item.inviteUrl || '') ||
            (String(item.chatId || '').startsWith('@')
              ? `https://t.me/${String(item.chatId).slice(1)}`
              : `https://t.me/${getBotUsername()}`),
          enabled: item.enabled !== false,
        }));
      }
    }
  } catch {
    // parse as comma list
  }

  return envRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, idx) => {
      const [chatId, title] = entry.split('|').map((x) => x.trim());
      const cleanHandle = chatId.startsWith('@') ? chatId.slice(1) : '';
      return {
        id: `env_${idx}`,
        chatId,
        title: title || (cleanHandle ? `کانال ${cleanHandle}` : `کانال ${idx + 1}`),
        inviteUrl: cleanHandle ? `https://t.me/${cleanHandle}` : `https://t.me/${getBotUsername()}`,
        enabled: true,
      };
    });
}

/**
 * Verifies user's membership in all enabled forced channels strictly via Telegram Bot API getChatMember.
 * Never trusts client assertions.
 */
export async function verifyForcedChannelMembership(telegramUserId: string | number): Promise<ChannelMembershipResult> {
  const activeChannels = getForcedChannels().filter((c) => c.enabled);
  if (activeChannels.length === 0) {
    return { allJoined: true, checkedByApi: true, channels: [] };
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return {
      allJoined: false,
      checkedByApi: false,
      channels: activeChannels.map((c) => ({
        id: c.id,
        chatId: c.chatId,
        title: c.title,
        inviteUrl: c.inviteUrl,
        joined: false,
      })),
      error: 'تنظیمات ربات برای بررسی عضویت کامل نیست.',
    };
  }

  const results = await Promise.all(
    activeChannels.map(async (ch) => {
      const res = await callTelegramBot<{ status?: string; is_member?: boolean }>('getChatMember', {
        chat_id: ch.chatId,
        user_id: Number(telegramUserId),
      });
      const status = res.result?.status;
      const joined = Boolean(
        res.ok &&
          (status === 'creator' ||
            status === 'administrator' ||
            status === 'member' ||
            (status === 'restricted' && res.result?.is_member === true))
      );
      return {
        id: ch.id,
        chatId: ch.chatId,
        title: ch.title,
        inviteUrl: ch.inviteUrl,
        joined,
      };
    })
  );

  const allJoined = results.every((r) => r.joined);
  return { allJoined, checkedByApi: true, channels: results };
}

/**
 * Fetches latest Telegram profile photo file_id via Bot API when photo_url is missing from initData.
 * Returns a safe internal proxy path (/api/telegram/avatar?fileId=...) so TELEGRAM_BOT_TOKEN never leaks to client.
 */
export async function fetchTelegramAvatarProxyUrl(telegramUserId: number): Promise<string | null> {
  const photos = await callTelegramBot<{ total_count?: number; photos?: { file_id: string }[][] }>(
    'getUserProfilePhotos',
    { user_id: telegramUserId, limit: 1 }
  );
  if (!photos.ok || !photos.result?.photos?.length) return null;
  const sizes = photos.result.photos[0];
  if (!sizes || sizes.length === 0) return null;
  const best = sizes[sizes.length - 1];
  if (!best?.file_id) return null;
  return `/api/telegram/avatar?fileId=${encodeURIComponent(best.file_id)}`;
}

/**
 * Upserts a MADAR user strictly keyed by Telegram User ID.
 * - Creates a single account per Telegram User ID (never duplicates).
 * - Syncs fresh Telegram metadata (first_name, last_name, username, photo_url, language_code, last_login_at)
 *   WITHOUT overwriting user-customized MADAR profile fields (display_name if customized, bio, interests, city, etc.).
 */
export function upsertTelegramUser(
  tgUser: VerifiedTelegramUser,
  options?: { referralCode?: string; updateLoginTime?: boolean; resolvedPhotoUrl?: string | null }
): { userId: number; isNew: boolean; isBanned: boolean } {
  const db = getDb();
  const tgId = String(tgUser.id);
  const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim() || 'کاربر مدار';
  const cleanTgUsername = tgUser.username ? tgUser.username.replace(/^@/, '').slice(0, 40) : null;
  const photoUrl = tgUser.photo_url || options?.resolvedPhotoUrl || null;
  const langCode = tgUser.language_code || null;

  const existing = db
    .prepare(
      'SELECT id, display_name, telegram_first_name, telegram_last_name, telegram_photo_url, is_banned FROM users WHERE telegram_id = ? AND is_deleted = 0'
    )
    .get(tgId) as
    | {
        id: number;
        display_name: string;
        telegram_first_name: string | null;
        telegram_last_name: string | null;
        telegram_photo_url: string | null;
        is_banned: number;
      }
    | undefined;

  if (existing) {
    if (existing.is_banned) {
      return { userId: existing.id, isNew: false, isBanned: true };
    }

    // Preserve MADAR display_name if user customized it; otherwise keep synced with Telegram name
    const prevTgFull = [existing.telegram_first_name, existing.telegram_last_name].filter(Boolean).join(' ').trim();
    const shouldSyncDisplay = !existing.display_name || (prevTgFull && existing.display_name === prevTgFull);

    db.prepare(`
      UPDATE users
      SET telegram_first_name = ?,
          telegram_last_name = ?,
          telegram_username = ?,
          telegram_photo_url = COALESCE(?, telegram_photo_url),
          telegram_language_code = COALESCE(?, telegram_language_code),
          display_name = ?,
          last_active_at = datetime('now'),
          last_login_at = CASE WHEN ? = 1 THEN datetime('now') ELSE last_login_at END
      WHERE id = ?
    `).run(
      tgUser.first_name || null,
      tgUser.last_name || null,
      cleanTgUsername,
      photoUrl,
      langCode,
      shouldSyncDisplay ? fullName : existing.display_name,
      options?.updateLoginTime ? 1 : 0,
      existing.id
    );

    return { userId: existing.id, isNew: false, isBanned: false };
  }

  // Create new account strictly tied to telegram_id
  const baseHandle = (cleanTgUsername || `tg_${tgId}`).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 22) || `tg_${tgId.slice(-6)}`;
  let candidateUname = baseHandle;
  const existsUname = db.prepare('SELECT 1 FROM users WHERE lower(username) = ?').get(candidateUname);
  if (existsUname) {
    candidateUname = `${baseHandle.slice(0, 18)}_${crypto.randomInt(100, 999)}`;
  }

  const refCode = `ref_${tgId.slice(-6)}${crypto.randomInt(10, 99)}`;
  let referrerId: number | null = null;
  if (options?.referralCode) {
    const cleanRef = options.referralCode.trim();
    const refRow = db
      .prepare('SELECT id FROM users WHERE referral_code = ? AND is_deleted = 0')
      .get(cleanRef) as { id: number } | undefined;
    if (refRow) referrerId = refRow.id;
  }

  const newId = db.transaction(() => {
    const res = db
      .prepare(`
        INSERT INTO users (
          telegram_id, username, display_name,
          telegram_first_name, telegram_last_name, telegram_username,
          telegram_photo_url, telegram_language_code,
          referral_code, referred_by_user_id, anon_slug,
          last_login_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .run(
        tgId,
        candidateUname,
        fullName,
        tgUser.first_name || null,
        tgUser.last_name || null,
        cleanTgUsername,
        photoUrl,
        langCode,
        refCode,
        referrerId,
        candidateUname
      );

    const uid = Number(res.lastInsertRowid);
    db.prepare(`
      INSERT INTO user_profiles (user_id, avatar_initials, interests, dating_enabled)
      VALUES (?, ?, ?, 0)
    `).run(uid, fullName.slice(0, 2), JSON.stringify(['بازی گروهی', 'گفت‌وگو']));

    db.prepare('INSERT INTO star_wallets (user_id, free_stars, paid_stars) VALUES (?, 100, 0)').run(uid);
    db.prepare(
      "INSERT INTO star_transactions (user_id, amount, star_bucket, tx_type, description) VALUES (?, 100, 'free', 'welcome_bonus', 'پاداش ورود به مدار')"
    ).run(uid);
    db.prepare(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'welcome', 'به مدار خوش آمدی!', '۱۰۰ ستاره خوش‌آمدگویی به کیف‌پول تو واریز شد.')"
    ).run(uid);

    if (referrerId && referrerId !== uid) {
      const econRow = db.prepare("SELECT value_json FROM system_settings WHERE key = 'economy'").get() as
        | { value_json: string }
        | undefined;
      const rewardStars = econRow ? Number(JSON.parse(econRow.value_json).referralRewardStars || 50) : 50;
      db.prepare(
        "INSERT INTO referral_events (referrer_user_id, referred_user_id, status, reward_stars) VALUES (?, ?, 'verified', ?)"
      ).run(referrerId, uid, rewardStars);
      adjustStarsAtomic(referrerId, rewardStars, 'free', 'referral_reward', `پاداش دعوت @${candidateUname}`, String(uid));
    }

    return uid;
  })();

  return { userId: newId, isNew: true, isBanned: false };
}
