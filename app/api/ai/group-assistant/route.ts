import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { checkRateLimit, getAuthUser, getClientIp } from '@/lib/security';
import { askMadarGroupAssistant } from '@/lib/gemini';

const AssistantReqSchema = z.object({
  groupId: z.number().int().positive().default(1),
  message: z.string().min(1, 'پیام نمی‌تواند خالی باشد').max(500),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const auth = getAuthUser(req);
  const rl = checkRateLimit(`ai:${auth?.id ?? ip}`, 15, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `محدودیت نرخ درخواست هوش مصنوعی فعال شد. لطفاً ${rl.retryAfterSec} ثانیه دیگر تلاش کنید.` },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = AssistantReqSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'پیام نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();
  const group = db.prepare('SELECT * FROM telegram_groups WHERE id = ?').get(parsed.data.groupId) as
    | {
        id: number;
        title: string;
        ai_enabled: number;
        ai_humor_level: string;
        ai_max_reply_chars: number;
        ai_daily_limit: number;
        ai_used_today: number;
        ai_allowed_topics: string;
      }
    | undefined;

  if (!group) {
    return NextResponse.json({ error: 'گروه موردنظر یافت نشد.' }, { status: 404 });
  }

  if (!group.ai_enabled) {
    return NextResponse.json({ error: 'دستیار هوش مصنوعی در تنظیمات این گروه غیرفعال است.' }, { status: 403 });
  }

  if (group.ai_used_today >= group.ai_daily_limit) {
    return NextResponse.json({ error: 'سقف مصرف روزانه هوش مصنوعی این گروه به پایان رسیده است.' }, { status: 429 });
  }

  try {
    const result = await askMadarGroupAssistant({
      groupTitle: group.title,
      humorLevel: group.ai_humor_level,
      maxChars: group.ai_max_reply_chars,
      allowedTopics: group.ai_allowed_topics,
      userMessage: parsed.data.message.trim(),
      senderName: auth?.display_name || 'کاربر مدار',
    });

    db.transaction(() => {
      db.prepare('UPDATE telegram_groups SET ai_used_today = ai_used_today + 1 WHERE id = ?').run(group.id);
      db.prepare(
        "INSERT INTO ai_usage_logs (user_id, group_id, model, prompt_chars, response_chars, status) VALUES (?, ?, ?, ?, ?, 'ok')"
      ).run(auth?.id ?? null, group.id, result.model, parsed.data.message.length, result.text.length);
    })();

    return NextResponse.json({
      ok: true,
      reply: result.text,
      model: result.model,
      remainingQuota: Math.max(0, group.ai_daily_limit - (group.ai_used_today + 1)),
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'UNKNOWN';
    db.prepare(
      "INSERT INTO ai_usage_logs (user_id, group_id, model, prompt_chars, response_chars, status) VALUES (?, ?, 'gemini-4-hydrogen', ?, 0, ?)"
    ).run(auth?.id ?? null, group.id, parsed.data.message.length, rawMsg.slice(0, 80));

    if (rawMsg === 'GEMINI_API_KEY_NOT_CONFIGURED') {
      return NextResponse.json(
        {
          error:
            'کلید Gemini API در تنظیمات سرور (Settings > Secrets) تنظیم نشده است. سایر امکانات مدار بدون اختلال فعال هستند.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error:
          'ارتباط با سرویس Gemini موقتاً با خطا مواجه شد. سایر قابلیت‌های ربات و بازی‌ها بدون مشکل در دسترس هستند.',
      },
      { status: 502 }
    );
  }
}
