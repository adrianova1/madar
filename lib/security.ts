import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { getDb } from './db';

// Server-only session signing secret (in-memory CSPRNG fallback if env not set)
const SESSION_PEPPER =
  process.env.SESSION_SECRET ||
  (globalThis as unknown as { __madarSessionPepper?: string }).__madarSessionPepper ||
  (() => {
    const generated = crypto.randomBytes(32).toString('hex');
    (globalThis as unknown as { __madarSessionPepper?: string }).__madarSessionPepper = generated;
    return generated;
  })();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function hashToken(rawToken: string): string {
  return crypto.createHmac('sha256', SESSION_PEPPER).update(rawToken).digest('hex');
}

export function createSession(userId: number, deviceLabel = 'وب / مینی‌اپ', ipAddress = 'unknown'): { token: string; sessionId: string } {
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
  is_banned: number;
  session_id: string;
}

export function getAuthUser(req: NextRequest): AuthUser | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const rawToken = authHeader.slice(7).trim();
  if (!rawToken || rawToken.length < 20) return null;

  const db = getDb();
  const tokenHash = hashToken(rawToken);
  const row = db
    .prepare(`
      SELECT u.id, u.telegram_id, u.username, u.display_name, u.role, u.subscription_tier,
             u.phone_verified, u.is_banned, s.id as session_id, s.expires_at
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
    is_banned: row.is_banned,
    session_id: row.session_id,
  };
}

/**
 * Cryptographically verifies Telegram WebApp initData per official Bot API spec:
 * secret_key = HMAC_SHA256("WebAppData", bot_token)
 * check_hash = HMAC_SHA256(secret_key, data_check_string)
 */
export function verifyTelegramInitData(initData: string, botToken: string): {
  valid: boolean;
  user?: { id: number; username?: string; first_name?: string; last_name?: string };
  error?: string;
} {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false, error: 'Missing hash in initData' };

    const authDateStr = params.get('auth_date');
    if (authDateStr) {
      const authDate = Number(authDateStr);
      if (Number.isFinite(authDate) && Math.floor(Date.now() / 1000) - authDate > 86400) {
        return { valid: false, error: 'initData expired' };
      }
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
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, error: 'Invalid Telegram signature' };
    }

    const userRaw = params.get('user');
    const parsedUser = userRaw ? JSON.parse(userRaw) : undefined;
    return { valid: true, user: parsedUser };
  } catch {
    return { valid: false, error: 'Malformed initData' };
  }
}

export function normalizeIranPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^\+989\d{9}$/.test(digits)) return digits;
  if (/^00989\d{9}$/.test(digits)) return `+98${digits.slice(4)}`;
  if (/^09\d{9}$/.test(digits)) return `+98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+98${digits}`;
  return null;
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

// Admin Bearer Token store (in-memory verified server sessions for RBAC)
interface AdminSession {
  username: string;
  role: string;
  expiresAt: number;
}
declare global {
  var __madarAdminSessions: Map<string, AdminSession> | undefined;
}
function getAdminSessionMap(): Map<string, AdminSession> {
  if (!globalThis.__madarAdminSessions) {
    globalThis.__madarAdminSessions = new Map();
  }
  return globalThis.__madarAdminSessions;
}

export function createAdminSession(username: string, role: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  getAdminSessionMap().set(hashToken(token), {
    username,
    role,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  });
  return token;
}

export function getAdminSession(req: NextRequest): { username: string; role: string } | null {
  const header = req.headers.get('x-admin-token');
  if (!header || header.length < 20) return null;
  const sess = getAdminSessionMap().get(hashToken(header));
  if (!sess || sess.expiresAt < Date.now()) return null;
  return { username: sess.username, role: sess.role };
}

export function writeAuditLog(adminUsername: string, adminRole: string, action: string, target: string, details = '') {
  const db = getDb();
  db.prepare(
    'INSERT INTO audit_logs (admin_username, admin_role, action, target, details) VALUES (?, ?, ?, ?, ?)'
  ).run(adminUsername, adminRole, action, target, details);
}

export function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
}
