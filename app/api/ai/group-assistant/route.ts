import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { checkRateLimit, getAuthUser, getClientIp } from '@/lib/security';
import { generateLocalGroupReply } from '@/lib/moderation-engine';

const LocalAssistantReqSchema = z.object({
  groupId: z.number().int().positive().default(1),
  message: z.string().min(1, 'پیام نمی‌تواند خالی باشد').max(500),
});

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });
  }

  const ip = getClientIp(req);
  const rl = checkRateLimit(`local_group_bot:${auth.id}:${ip}`, 25, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `تعداد درخواست‌ها زیاد است. ${rl.retryAfterSec} ثانیه صبر کنید.` },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = LocalAssistantReqSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'پیام نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();
  const group = db.prepare('SELECT * FROM telegram_groups WHERE id = ?').get(parsed.data.groupId) as
    | {
        id: number;
        title: string;
        owner_user_id: number | null;
        rules_text: string;
        welcome_text: string;
        anti_link: number;
        anti_ads: number;
        anti_spam: number;
        anti_flood: number;
        anti_tabchi: number;
        lock_media: number;
        ai_enabled: number;
      }
    | undefined;

  if (!group) {
    return NextResponse.json({ error: 'گروه موردنظر یافت نشد.' }, { status: 404 });
  }

  // Only authorized group admin/owner or platform admin may invoke the group assistant console
  const isAdmin =
    auth.role === 'admin' ||
    (group.owner_user_id && Number(group.owner_user_id) === auth.id) ||
    Boolean(
      db
        .prepare("SELECT 1 FROM telegram_group_admins WHERE group_id = ? AND user_id = ? AND telegram_status IN ('creator', 'administrator')")
        .get(group.id, auth.id)
    );
  if (!isAdmin) {
    return NextResponse.json({ error: 'شما مجوز مدیریت این گروه را ندارید.' }, { status: 403 });
  }

  if (!group.ai_enabled) {
    return NextResponse.json({ error: 'پاسخ‌گوی خودکار محلی در این گروه غیرفعال است.' }, { status: 403 });
  }

  const activeProtections: string[] = [];
  if (group.anti_link) activeProtections.push('ضدلینک');
  if (group.anti_ads) activeProtections.push('ضدتبلیغ');
  if (group.anti_spam) activeProtections.push('ضداسپم');
  if (group.anti_flood) activeProtections.push('ضدFlood');
  if (group.anti_tabchi) activeProtections.push('ضدتبچی');
  if (group.lock_media) activeProtections.push('قفل رسانه');

  const result = generateLocalGroupReply({
    groupTitle: group.title,
    rulesText: group.rules_text || '',
    welcomeText: group.welcome_text || '',
    userMessage: parsed.data.message.trim(),
    senderName: auth.display_name,
    activeProtections,
  });

  db.prepare(
    "INSERT INTO ai_usage_logs (user_id, group_id, model, prompt_chars, response_chars, status) VALUES (?, ?, ?, ?, ?, 'ok')"
  ).run(auth.id, group.id, result.engine, parsed.data.message.length, result.text.length);

  return NextResponse.json({
    ok: true,
    reply: result.text,
    model: 'موتور محلی مدار',
  });
}
