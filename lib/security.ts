import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { getDb } from './db';

const IS_PROD = process.env.NODE_ENV === 'production';

function getSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim() || '';
  if (IS_PROD) {
    if (envSecret.length < 16) {
      throw new Error('SESSION_SECRET_REQUIRED_IN_PRODUCTION');
    }
    return envSecret;
  }
  if (envSecret.length >= 16) return envSecret;

  // In development only, keep a stable in-memory random secret per process
  const g = globalThis as unknown as { __madarDevSessionSecret?: string };
  if (!g.__madarDevSessionSecret) {
    g.__madarDevSessionSecret = crypto.randomBytes(32).toString('hex');
  }
  return g.__madarDevSessionSecret;
}

export function isSessionSecretConfigured(): boolean {
  const envSecret = process.env.SESSION_SECRET?.trim() || '';
  return envSecret.length >= 16;
}

export function hashToken(rawToken: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(rawToken).digest('hex');
}

export function createSession(
  userId: number,
  deviceLabel = 'Telegram Mini App',
  ipAddress = 'unknown'
): { token: string; sessionId: string } {
  const db = getDb();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO user_sessions (id, user_id, token_hash, device_label, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, tokenHash, deviceLabel, ipAddress, expiresAt);

  return { token: rawToken, sessionId };
}

export interface AuthUser {
  id: number;
  telegram_id: string | null;
  username: string;
  display_name: string;
  role: string;
  subscription_tier: string;
  phone_verified: number;
  onboarding_completed: number;
  is_banned: number;
  session_id: string;
}

export function getAuthUser(req: NextRequest): AuthUser | null {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const rawToken = authHeader.slice(7).trim();
    if (!rawToken || rawToken.length < 20) return null;

    const db = getDb();
    const tokenHash = hashToken(rawToken);
    const row = db
      .prepare(`
        SELECT u.id, u.telegram_id, u.username, u.display_name, u.role, u.subscription_tier,
               u.phone_verified, u.onboarding_completed, u.is_banned, s.id as session_id, s.expires_at
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.revoked = 0 AND u.is_deleted = 0
      `)
      .get(tokenHash) as (AuthUser & { expires_at: string }) | undefined;

    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    if (row.is_banned) return null;

    db.prepare("UPDATE users SET last_active_at = datetime('now') WHERE id = ?").run(row.id);
    return {
      id: row.id,
      telegram_id: row.telegram_id,
      username: row.username,
      display_name: row.display_name,
      role: row.role,
      subscription_tier: row.subscription_tier,
      phone_verified: row.phone_verified,
      onboarding_completed: row.onboarding_completed,
      is_banned: row.is_banned,
      session_id: row.session_id,
    };
  } catch {
    return null;
  }
}

export interface VerifiedTelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

/**
 * Cryptographically verifies Telegram WebApp initData per official Bot API spec:
 * secret_key = HMAC_SHA256("WebAppData", bot_token)
 * check_hash = HMAC_SHA256(secret_key, data_check_string)
 * Strictly validates auth_date (required, not expired, not far in future) & user.id.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400
): {
  valid: boolean;
  user?: VerifiedTelegramUser;
  authDate?: number;
  startParam?: string;
  error?: string;
} {
  try {
    if (!initData || !botToken) {
      return { valid: false, error: 'اطلاعات احراز هویت تلگرام ناقص است.' };
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      return { valid: false, error: 'امضای امنیتی تلگرام یافت نشد.' };
    }

    const authDateStr = params.get('auth_date');
    if (!authDateStr || !/^\d+$/.test(authDateStr)) {
      return { valid: false, error: 'زمان اعتبار درخواست تلگرام نامعتبر است.' };
    }
    const authDate = Number(authDateStr);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSeconds || authDate - nowSec > 120) {
      return { valid: false, error: 'نشست تلگرام منقضی شده است. لطفاً برنامه را دوباره از ربات باز کنید.' };
    }

    const pairs: string[] = [];
    params.forEach((value, key) => {
      if (key !== 'hash') pairs.push(`${key}=${value}`);
    });
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const a = Buffer.from(computedHash, 'hex');
    const b = Buffer.from(hash.toLowerCase(), 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, error: 'امضای امنیتی Telegram initData معتبر نیست.' };
    }

    const userRaw = params.get('user');
    if (!userRaw) {
      return { valid: false, error: 'اطلاعات کاربری تلگرام در درخواست وجود ندارد.' };
    }

    const parsedUser = JSON.parse(userRaw) as Partial<VerifiedTelegramUser>;
    if (!parsedUser || typeof parsedUser.id !== 'number' || !Number.isInteger(parsedUser.id) || parsedUser.id <= 0) {
      return { valid: false, error: 'شناسه کاربری تلگرام نامعتبر است.' };
    }

    // Validate photo_url scheme if present
    let safePhotoUrl: string | undefined;
    if (typeof parsedUser.photo_url === 'string' && /^https:\/\//i.test(parsedUser.photo_url)) {
      safePhotoUrl = parsedUser.photo_url.slice(0, 500);
    }

    return {
      valid: true,
      authDate,
      startParam: params.get('start_param') || undefined,
      user: {
        id: parsedUser.id,
        first_name: String(parsedUser.first_name || 'کاربر مدار').slice(0, 64),
        last_name: parsedUser.last_name ? String(parsedUser.last_name).slice(0, 64) : undefined,
        username: parsedUser.username ? String(parsedUser.username).slice(0, 64) : undefined,
        language_code: parsedUser.language_code ? String(parsedUser.language_code).slice(0, 16) : undefined,
        photo_url: safePhotoUrl,
      },
    };
  } catch {
    return { valid: false, error: 'ساختار Telegram initData نامعتبر است.' };
  }
}

/**
 * Normalizes a verified Telegram Contact phone number to E.164 (+digits).
 */
export function normalizeTelegramPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith('00') && digits.length >= 10) {
    return `+${digits.slice(2)}`;
  }
  if (digits.startsWith('09') && digits.length === 11) {
    return `+98${digits.slice(1)}`;
  }
  return `+${digits}`;
}

export function calculateAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

// In-memory sliding-window rate limiter
const rateBuckets = new Map<string, number[]>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const list = (rateBuckets.get(key) ?? []).filter((ts) => now - ts < windowMs);
  if (list.length >= maxRequests) {
    const oldest = list[0];
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }
  list.push(now);
  rateBuckets.set(key, list);
  return { allowed: true, retryAfterSec: 0 };
}

function safeEqualStrings(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Checks whether the given verified Telegram User ID matches process.env.ADMIN_TELEGRAM_ID.
 * Never hardcoded; returns false if env var is unset or invalid.
 */
export function isPrimaryAdminTelegramId(telegramId: string | number | null | undefined): boolean {
  const expected = process.env.ADMIN_TELEGRAM_ID?.trim() || '';
  if (!expected || !/^\d+$/.test(expected)) return false;
  if (telegramId === null || telegramId === undefined) return false;
  const actual = String(telegramId).trim();
  if (!/^\d+$/.test(actual)) return false;
  return safeEqualStrings(actual, expected);
}

export interface DelegatedAdminEntry {
  telegramId: string;
  label: string;
  role: 'Admin' | 'Moderator' | 'Support' | 'Content Manager' | 'Game Manager';
  addedAt: string;
}

export function getDelegatedAdmins(): DelegatedAdminEntry[] {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'delegated_admins'").get() as
      | { value_json: string }
      | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.value_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function resolveAdminAuthority(auth: AuthUser | null): {
  isAdmin: boolean;
  isPrimaryAdmin: boolean;
  role: string | null;
} {
  if (!auth || !auth.telegram_id) {
    return { isAdmin: false, isPrimaryAdmin: false, role: null };
  }
  if (isPrimaryAdminTelegramId(auth.telegram_id)) {
    return { isAdmin: true, isPrimaryAdmin: true, role: 'Super Admin' };
  }
  const delegated = getDelegatedAdmins().find((d) => safeEqualStrings(d.telegramId, String(auth.telegram_id)));
  if (delegated) {
    return { isAdmin: true, isPrimaryAdmin: false, role: delegated.role };
  }
  return { isAdmin: false, isPrimaryAdmin: false, role: null };
}

export function writeAuditLog(adminUsername: string, adminRole: string, action: string, target: string, details = '') {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO audit_logs (admin_username, admin_role, action, target, details) VALUES (?, ?, ?, ?, ?)'
    ).run(adminUsername, adminRole, action, target, details);
  } catch {
    // Do not break caller on audit write failure
  }
}

export function logSystemError(source: string, message: string, details = '') {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO system_error_logs (source, message, details) VALUES (?, ?, ?)'
    ).run(source.slice(0, 80), message.slice(0, 300), details.slice(0, 800));
  } catch {
    // Ignore logging errors
  }
}

export function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
}
