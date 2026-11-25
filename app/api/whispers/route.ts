import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { checkRateLimit, getAuthUser, getClientIp } from '@/lib/security';

const WhisperPostSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send'),
    recipientSlug: z.string().min(2).max(40),
    message: z.string().min(2, 'متن نجوا خیلی کوتاه است').max(500, 'حداکثر ۵۰۰ کاراکتر مجاز است'),
    alias: z.string().max(30).optional(),
    source: z.enum(['mini_app', 'group_whisper', 'anon_link']).optional(),
  }),
  z.object({
    action: z.literal('reply'),
    whisperId: z.number().int().positive(),
    replyText: z.string().min(1).max(500),
    acceptTwoWay: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('block'),
    whisperId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal('report'),
    whisperId: z.number().int().positive(),
    reason: z.string().min(3).max(200),
  }),
]);

const HARMFUL_PATTERNS = ['تهدید به مرگ', 'خودکشی', 'افشای عکس', 'اخاذی'];

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  // IMPORTANT PRIVACY RULE: Never return sender_user_id or sender username to recipient!
  const inbox = db
    .prepare(`
      SELECT id, sender_alias, message, reply_text, two_way_accepted, is_blocked, is_reported, source, created_at, replied_at
      FROM whispers
      WHERE recipient_user_id = ? AND is_blocked = 0
      ORDER BY id DESC
      LIMIT 40
    `)
    .all(auth.id);

  const sent = db
    .prepare(`
      SELECT w.id, w.message, w.reply_text, w.two_way_accepted, w.source, w.created_at, w.replied_at,
             u.display_name as recipient_name, u.username as recipient_username
      FROM whispers w
      JOIN users u ON u.id = w.recipient_user_id
      WHERE w.sender_user_id = ?
      ORDER BY w.id DESC
      LIMIT 30
    `)
    .all(auth.id);

  const directory = db
    .prepare(`
      SELECT u.username, u.display_name, u.anon_slug, p.avatar_initials, p.avatar_color
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id != ? AND u.allow_whispers = 1 AND u.is_deleted = 0 AND u.is_banned = 0
      ORDER BY u.last_active_at DESC
      LIMIT 15
    `)
    .all(auth.id);

  return NextResponse.json({ inbox, sent, directory });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const auth = getAuthUser(req);
  const body = await req.json().catch(() => null);
  const parsed = WhisperPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'اطلاعات ارسالی نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();
  const data = parsed.data;

  if (data.action === 'send') {
    const rl = checkRateLimit(`whisper_send:${auth?.id ?? ip}`, 10, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `تعداد نجواهای ارسالی بیش از حد مجاز است. لطفاً ${rl.retryAfterSec} ثانیه صبر کنید.` },
        { status: 429 }
      );
    }

    if (HARMFUL_PATTERNS.some((p) => data.message.includes(p))) {
      return NextResponse.json({ error: 'این پیام به دلیل نقض قوانین ایمنی و ضدآزار مدار مسدود شد.' }, { status: 400 });
    }

    const cleanSlug = data.recipientSlug.trim().toLowerCase().replace(/^@/, '');
    const recipient = db
      .prepare('SELECT id, allow_whispers FROM users WHERE (lower(anon_slug) = ? OR lower(username) = ?) AND is_deleted = 0')
      .get(cleanSlug, cleanSlug) as { id: number; allow_whispers: number } | undefined;

    if (!recipient) {
      return NextResponse.json({ error: 'کاربر مقصد با این شناسه در مدار پیدا نشد.' }, { status: 404 });
    }
    if (!recipient.allow_whispers) {
      return NextResponse.json({ error: 'این کاربر دریافت پیام ناشناس را غیرفعال کرده است.' }, { status: 403 });
    }
    if (auth && recipient.id === auth.id) {
      return NextResponse.json({ error: 'نمی‌توانی برای خودت نجوا ارسال کنی.' }, { status: 400 });
    }

    if (auth) {
      const blocked = db
        .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
        .get(recipient.id, auth.id);
      if (blocked) {
        return NextResponse.json({ error: 'ارسال پیام به این کاربر امکان‌پذیر نیست.' }, { status: 403 });
      }
    }

    const alias = (data.alias?.trim() || 'مسافر ناشناس نپتون').slice(0, 30);
    const res = db
      .prepare(`
        INSERT INTO whispers (recipient_user_id, sender_user_id, sender_alias, message, source)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(recipient.id, auth?.id ?? null, alias, data.message.trim(), data.source ?? 'mini_app');

    db.prepare(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'whisper', 'نجوای ناشناس جدید در نپتون', 'یک پیام ناشناس تازه برای تو ثبت شده است.')"
    ).run(recipient.id);

    return NextResponse.json({ ok: true, whisperId: Number(res.lastInsertRowid), message: 'نجوای تو به‌صورت ناشناس ارسال شد.' }, { status: 201 });
  }

  if (!auth) return NextResponse.json({ error: 'برای مدیریت نجواها باید وارد حساب شوید.' }, { status: 401 });

  const whisper = db
    .prepare('SELECT id, recipient_user_id, sender_user_id FROM whispers WHERE id = ?')
    .get(data.whisperId) as { id: number; recipient_user_id: number; sender_user_id: number | null } | undefined;

  if (!whisper || whisper.recipient_user_id !== auth.id) {
    return NextResponse.json({ error: 'دسترسی به این نجوا مجاز نیست.' }, { status: 403 });
  }

  if (data.action === 'reply') {
    db.prepare(
      "UPDATE whispers SET reply_text = ?, two_way_accepted = ?, replied_at = datetime('now') WHERE id = ?"
    ).run(data.replyText.trim(), data.acceptTwoWay ? 1 : 0, whisper.id);

    if (whisper.sender_user_id) {
      db.prepare(
        "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'whisper', 'پاسخ ناشناس دریافت شد', 'گیرنده به نجوای ناشناس تو پاسخ داد.')"
      ).run(whisper.sender_user_id);
    }

    return NextResponse.json({ ok: true, message: 'پاسخ ناشناس ثبت شد.' });
  }

  if (data.action === 'block') {
    db.transaction(() => {
      db.prepare('UPDATE whispers SET is_blocked = 1 WHERE id = ?').run(whisper.id);
      if (whisper.sender_user_id) {
        db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(auth.id, whisper.sender_user_id);
      }
    })();
    return NextResponse.json({ ok: true, message: 'فرستنده مسدود شد و دیگر نمی‌تواند برایت نجوا بفرستد.' });
  }

  if (data.action === 'report') {
    db.transaction(() => {
      db.prepare('UPDATE whispers SET is_reported = 1, is_blocked = 1 WHERE id = ?').run(whisper.id);
      db.prepare("INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, 'whisper', ?, ?)").run(
        auth.id,
        String(whisper.id),
        data.reason.trim()
      );
    })();
    return NextResponse.json({ ok: true, message: 'گزارش سوءاستفاده برای بررسی امنیتی مدیریت ثبت شد.' });
  }

  return NextResponse.json({ error: 'عملیات نامعتبر' }, { status: 400 });
}
