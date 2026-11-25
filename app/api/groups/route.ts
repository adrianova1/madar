import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { AuthUser, getAuthUser } from '@/lib/security';
import { evaluateGroupMessage, GroupModerationRules, ModerationSensitivity } from '@/lib/moderation-engine';

const UpdateGroupSchema = z.object({
  groupId: z.number().int().positive(),
  anti_link: z.boolean().optional(),
  anti_ads: z.boolean().optional(),
  anti_spam: z.boolean().optional(),
  anti_flood: z.boolean().optional(),
  anti_tabchi: z.boolean().optional(),
  lock_media: z.boolean().optional(),
  sensitivity_level: z.enum(['low', 'medium', 'strict']).optional(),
  mute_duration_minutes: z.number().int().min(1).max(1440).optional(),
  banned_words: z.string().max(400).optional(),
  welcome_text: z.string().max(400).optional(),
  rules_text: z.string().max(800).optional(),
  ai_enabled: z.boolean().optional(),
});

const TestModSchema = z.object({
  groupId: z.number().int().positive(),
  action: z.enum(['test_message', 'command']),
  message: z.string().max(500).optional(),
  hasMedia: z.boolean().optional(),
  isForwarded: z.boolean().optional(),
  command: z.enum(['/warn', '/mute', '/unmute', '/ban', '/lock', '/unlock', '/clean', '/rules']).optional(),
  targetLabel: z.string().max(60).optional(),
  targetTelegramUserId: z.number().int().positive().optional(),
});

interface GroupRow extends GroupModerationRules {
  id: number;
  chat_id: string;
  title: string;
  owner_user_id: number | null;
  rules_text: string;
  welcome_text: string;
  ai_enabled: number;
  sensitivity_level: ModerationSensitivity;
  anti_tabchi: number;
  mute_duration_minutes: number;
}

/**
 * Verifies whether a MADAR user is genuinely authorized to manage a Telegram group:
 * 1. Explicit platform admin role (`role === 'admin'`), OR
 * 2. Recorded group owner (`owner_user_id === auth.id`), OR
 * 3. Live verification via Telegram Bot API `getChatMember` confirming `creator` or `administrator`
 *    status (with 10-minute server cache in `telegram_group_admins`).
 * Merely being signed into MADAR NEVER grants group management permissions.
 */
async function verifyUserCanManageGroup(auth: AuthUser, group: GroupRow): Promise<boolean> {
  if (auth.role === 'admin') return true;
  if (group.owner_user_id && Number(group.owner_user_id) === auth.id) return true;

  const db = getDb();
  const cached = db
    .prepare(
      "SELECT telegram_status, verified_at FROM telegram_group_admins WHERE group_id = ? AND user_id = ? AND datetime(verified_at, '+10 minutes') > datetime('now')"
    )
    .get(group.id, auth.id) as { telegram_status: string } | undefined;
  if (cached && (cached.telegram_status === 'creator' || cached.telegram_status === 'administrator')) {
    return true;
  }

  // Real Telegram Bot API admin verification when token & user's telegram_id are available
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tgId = auth.telegram_id?.trim();
  if (!botToken || !tgId || !/^\d+$/.test(tgId)) {
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(
      group.chat_id
    )}&user_id=${encodeURIComponent(tgId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean; result?: { status?: string } };
    const status = data?.result?.status;
    if (data?.ok && (status === 'creator' || status === 'administrator')) {
      db.prepare(`
        INSERT INTO telegram_group_admins (group_id, user_id, telegram_status, verified_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(group_id, user_id) DO UPDATE SET telegram_status = excluded.telegram_status, verified_at = datetime('now')
      `).run(group.id, auth.id, status);
      return true;
    }
    // Revoke stale cache if user is no longer an admin in Telegram
    db.prepare('DELETE FROM telegram_group_admins WHERE group_id = ? AND user_id = ?').run(group.id, auth.id);
    return false;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'برای مشاهده مدیریت گروه ابتدا وارد حساب شوید.' }, { status: 401 });
  }

  const db = getDb();
  const allGroups = db.prepare('SELECT * FROM telegram_groups ORDER BY id ASC').all() as GroupRow[];

  const authorizedGroups: GroupRow[] = [];
  for (const g of allGroups) {
    if (await verifyUserCanManageGroup(auth, g)) {
      authorizedGroups.push(g);
    }
  }

  if (authorizedGroups.length === 0) {
    return NextResponse.json({
      groups: [],
      logs: [],
      authorized: false,
      message: 'شما مدیر تأییدشده هیچ گروه تلگرامی نیستید. ربات مدار را در گروه خود ادمین کنید.',
    });
  }

  const ids = authorizedGroups.map((g) => g.id);
  const placeholders = ids.map(() => '?').join(',');
  const logs = db
    .prepare(
      `SELECT id, group_id, command, target_label, reason, actor_label, created_at
       FROM moderation_logs
       WHERE group_id IN (${placeholders})
       ORDER BY id DESC LIMIT 25`
    )
    .all(...ids);

  return NextResponse.json({ groups: authorizedGroups, logs, authorized: true });
}

export async function PATCH(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = UpdateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'تنظیمات ارسالی نامعتبر است.' }, { status: 400 });
  }

  const d = parsed.data;
  const db = getDb();
  const current = db.prepare('SELECT * FROM telegram_groups WHERE id = ?').get(d.groupId) as GroupRow | undefined;
  if (!current) return NextResponse.json({ error: 'گروه یافت نشد.' }, { status: 404 });

  const allowed = await verifyUserCanManageGroup(auth, current);
  if (!allowed) {
    return NextResponse.json(
      { error: 'شما مجوز مدیریت این گروه تلگرام را ندارید. فقط ادمین تأییدشده گروه مجاز است.' },
      { status: 403 }
    );
  }

  db.prepare(`
    UPDATE telegram_groups SET
      anti_link = ?, anti_ads = ?, anti_spam = ?, anti_flood = ?, anti_tabchi = ?, lock_media = ?,
      sensitivity_level = ?, mute_duration_minutes = ?,
      banned_words = ?, welcome_text = ?, rules_text = ?,
      ai_enabled = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    d.anti_link !== undefined ? (d.anti_link ? 1 : 0) : current.anti_link,
    d.anti_ads !== undefined ? (d.anti_ads ? 1 : 0) : current.anti_ads,
    d.anti_spam !== undefined ? (d.anti_spam ? 1 : 0) : current.anti_spam,
    d.anti_flood !== undefined ? (d.anti_flood ? 1 : 0) : current.anti_flood,
    d.anti_tabchi !== undefined ? (d.anti_tabchi ? 1 : 0) : current.anti_tabchi,
    d.lock_media !== undefined ? (d.lock_media ? 1 : 0) : current.lock_media,
    d.sensitivity_level ?? current.sensitivity_level ?? 'medium',
    d.mute_duration_minutes ?? current.mute_duration_minutes ?? 10,
    d.banned_words ?? current.banned_words,
    d.welcome_text ?? current.welcome_text,
    d.rules_text ?? current.rules_text,
    d.ai_enabled !== undefined ? (d.ai_enabled ? 1 : 0) : current.ai_enabled,
    d.groupId
  );

  db.prepare(
    'INSERT INTO moderation_logs (group_id, command, target_label, reason, actor_label) VALUES (?, ?, ?, ?, ?)'
  ).run(d.groupId, '/settings', String(current.title), 'ذخیره قوانین محافظت محلی گروه', `@${auth.username}`);

  const updated = db.prepare('SELECT * FROM telegram_groups WHERE id = ?').get(d.groupId);
  return NextResponse.json({ ok: true, group: updated, message: 'تنظیمات گروه ذخیره شد.' });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = TestModSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });

  const db = getDb();
  const group = db.prepare('SELECT * FROM telegram_groups WHERE id = ?').get(parsed.data.groupId) as GroupRow | undefined;
  if (!group) return NextResponse.json({ error: 'گروه یافت نشد.' }, { status: 404 });

  const allowed = await verifyUserCanManageGroup(auth, group);
  if (!allowed) {
    return NextResponse.json({ error: 'فقط مدیر تأییدشده این گروه مجاز به اجرای دستورات است.' }, { status: 403 });
  }

  if (parsed.data.action === 'test_message') {
    const decision = evaluateGroupMessage(parsed.data.message || '', Boolean(parsed.data.hasMedia), group, {
      groupId: group.id,
      senderKey: `sim_${auth.id}`,
      hasMedia: Boolean(parsed.data.hasMedia),
      isForwarded: Boolean(parsed.data.isForwarded),
    });
    if (!decision.allowed) {
      db.prepare(
        'INSERT INTO moderation_logs (group_id, command, target_label, reason, actor_label) VALUES (?, ?, ?, ?, ?)'
      ).run(group.id, `auto:${decision.action}`, 'آزمون سپر محلی', decision.reason, 'موتور محلی زحل');
    }
    return NextResponse.json({ ok: true, decision });
  }

  const cmd = parsed.data.command!;
  const target = parsed.data.targetLabel?.trim() || 'عضو گروه';

  // If bot token & targetTelegramUserId are present, execute real Telegram restriction on /mute or /unmute
  let telegramExecuted = false;
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (botToken && parsed.data.targetTelegramUserId && (cmd === '/mute' || cmd === '/unmute')) {
    try {
      const canSend = cmd === '/unmute';
      const untilDate = canSend ? 0 : Math.floor(Date.now() / 1000) + (group.mute_duration_minutes || 10) * 60;
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/restrictChatMember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: group.chat_id,
          user_id: parsed.data.targetTelegramUserId,
          until_date: untilDate,
          permissions: {
            can_send_messages: canSend,
            can_send_audios: canSend,
            can_send_documents: canSend,
            can_send_photos: canSend,
            can_send_videos: canSend,
            can_send_other_messages: canSend,
          },
        }),
        signal: AbortSignal.timeout(5000),
      });
      const tgJson = (await tgRes.json().catch(() => null)) as { ok?: boolean } | null;
      telegramExecuted = Boolean(tgJson?.ok);
    } catch {
      telegramExecuted = false;
    }
  }

  db.prepare(
    'INSERT INTO moderation_logs (group_id, command, target_label, reason, actor_label) VALUES (?, ?, ?, ?, ?)'
  ).run(
    group.id,
    cmd,
    target,
    telegramExecuted ? `اجرای واقعی ${cmd} در تلگرام` : `ثبت دستور مدیریتی ${cmd}`,
    `@${auth.username}`
  );

  return NextResponse.json({
    ok: true,
    telegramExecuted,
    output:
      cmd === '/rules'
        ? group.rules_text
        : telegramExecuted
          ? `دستور ${cmd} روی تلگرام برای «${target}» اجرا و ثبت شد.`
          : `دستور ${cmd} برای «${target}» در گزارش گروه ثبت شد.`,
  });
}
