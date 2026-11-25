import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getAuthUser } from '@/lib/security';
import { evaluateGroupMessage, GroupModerationRules } from '@/lib/moderation-engine';

const UpdateGroupSchema = z.object({
  groupId: z.number().int().positive(),
  anti_link: z.boolean().optional(),
  anti_ads: z.boolean().optional(),
  anti_spam: z.boolean().optional(),
  anti_flood: z.boolean().optional(),
  lock_media: z.boolean().optional(),
  banned_words: z.string().max(400).optional(),
  welcome_text: z.string().max(400).optional(),
  rules_text: z.string().max(800).optional(),
  ai_enabled: z.boolean().optional(),
  ai_humor_level: z.enum(['جدی', 'متعادل', 'شوخ‌طبع']).optional(),
  ai_max_reply_chars: z.number().int().min(100).max(800).optional(),
  ai_daily_limit: z.number().int().min(10).max(500).optional(),
  ai_allowed_topics: z.string().max(300).optional(),
});

const TestModSchema = z.object({
  groupId: z.number().int().positive(),
  action: z.enum(['test_message', 'command']),
  message: z.string().max(500).optional(),
  hasMedia: z.boolean().optional(),
  command: z.enum(['/warn', '/mute', '/unmute', '/ban', '/lock', '/unlock', '/clean', '/rules']).optional(),
  targetLabel: z.string().max(60).optional(),
});

export async function GET() {
  const db = getDb();
  const groups = db.prepare('SELECT * FROM telegram_groups ORDER BY id ASC').all();
  const logs = db
    .prepare('SELECT id, group_id, command, target_label, reason, actor_label, created_at FROM moderation_logs ORDER BY id DESC LIMIT 20')
    .all();

  return NextResponse.json({ groups, logs });
}

export async function PATCH(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'برای تغییر تنظیمات گروه ابتدا وارد حساب شوید.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = UpdateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'تنظیمات ارسالی نامعتبر است.' }, { status: 400 });
  }

  const d = parsed.data;
  const db = getDb();
  const current = db.prepare('SELECT * FROM telegram_groups WHERE id = ?').get(d.groupId) as Record<string, unknown> | undefined;
  if (!current) return NextResponse.json({ error: 'گروه یافت نشد.' }, { status: 404 });

  db.prepare(`
    UPDATE telegram_groups SET
      anti_link = ?, anti_ads = ?, anti_spam = ?, anti_flood = ?, lock_media = ?,
      banned_words = ?, welcome_text = ?, rules_text = ?,
      ai_enabled = ?, ai_humor_level = ?, ai_max_reply_chars = ?, ai_daily_limit = ?, ai_allowed_topics = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    d.anti_link !== undefined ? (d.anti_link ? 1 : 0) : current.anti_link,
    d.anti_ads !== undefined ? (d.anti_ads ? 1 : 0) : current.anti_ads,
    d.anti_spam !== undefined ? (d.anti_spam ? 1 : 0) : current.anti_spam,
    d.anti_flood !== undefined ? (d.anti_flood ? 1 : 0) : current.anti_flood,
    d.lock_media !== undefined ? (d.lock_media ? 1 : 0) : current.lock_media,
    d.banned_words ?? current.banned_words,
    d.welcome_text ?? current.welcome_text,
    d.rules_text ?? current.rules_text,
    d.ai_enabled !== undefined ? (d.ai_enabled ? 1 : 0) : current.ai_enabled,
    d.ai_humor_level ?? current.ai_humor_level,
    d.ai_max_reply_chars ?? current.ai_max_reply_chars,
    d.ai_daily_limit ?? current.ai_daily_limit,
    d.ai_allowed_topics ?? current.ai_allowed_topics,
    d.groupId
  );

  db.prepare(
    'INSERT INTO moderation_logs (group_id, command, target_label, reason, actor_label) VALUES (?, ?, ?, ?, ?)'
  ).run(d.groupId, '/settings', String(current.title), 'به‌روزرسانی قوانین محافظت و هوش مصنوعی گروه', `@${auth.username}`);

  const updated = db.prepare('SELECT * FROM telegram_groups WHERE id = ?').get(d.groupId);
  return NextResponse.json({ ok: true, group: updated, message: 'تنظیمات محافظت گروه و هوش مصنوعی ذخیره شد.' });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = TestModSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });

  const db = getDb();
  const group = db.prepare('SELECT * FROM telegram_groups WHERE id = ?').get(parsed.data.groupId) as
    | (GroupModerationRules & { id: number; title: string; rules_text: string })
    | undefined;
  if (!group) return NextResponse.json({ error: 'گروه یافت نشد.' }, { status: 404 });

  if (parsed.data.action === 'test_message') {
    const decision = evaluateGroupMessage(parsed.data.message || '', Boolean(parsed.data.hasMedia), group);
    if (!decision.allowed) {
      db.prepare(
        'INSERT INTO moderation_logs (group_id, command, target_label, reason, actor_label) VALUES (?, ?, ?, ?, ?)'
      ).run(group.id, `auto:${decision.action}`, 'بررسی ضداسپم', decision.reason, 'محافظ زحل مدار');
    }
    return NextResponse.json({ ok: true, decision });
  }

  const cmd = parsed.data.command!;
  const target = parsed.data.targetLabel?.trim() || 'عضو گروه';
  db.prepare(
    'INSERT INTO moderation_logs (group_id, command, target_label, reason, actor_label) VALUES (?, ?, ?, ?, ?)'
  ).run(group.id, cmd, target, `اجرای دستور مدیریتی ${cmd} توسط ادمین`, `@${auth.username}`);

  return NextResponse.json({
    ok: true,
    output:
      cmd === '/rules'
        ? group.rules_text
        : `دستور ${cmd} برای «${target}» در سوابق مدیریتی گروه ثبت و اعمال شد.`,
  });
}
