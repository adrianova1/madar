import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { checkRateLimit, getAuthUser, getClientIp } from '@/lib/security';
import { verifyForcedChannelMembership } from '@/lib/telegram-bot';

const OnboardingActionSchema = z.object({
  action: z.enum(['check_channels', 'check_contact_status', 'decline_contact']),
  // Explicitly reject any attempt to smuggle a manually typed phone number
  phone: z.undefined().optional(),
  phoneNumber: z.undefined().optional(),
});

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'احراز هویت تلگرام الزامی است.' }, { status: 401 });
  }

  const ip = getClientIp(req);
  const rl = checkRateLimit(`onboarding:${auth.id}:${ip}`, 40, 5 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `تعداد درخواست‌ها زیاد است. ${rl.retryAfterSec} ثانیه صبر کنید.` },
      { status: 429 }
    );
  }

  const rawBody = await req.json().catch(() => null);
  if (rawBody && typeof rawBody === 'object' && ('phone' in rawBody || 'phoneNumber' in rawBody || 'phone_number' in rawBody)) {
    return NextResponse.json(
      { error: 'شماره تایپ‌شده یا دستی پذیرفته نمی‌شود. فقط از پنجره رسمی اشتراک‌گذاری شماره تلگرام استفاده کنید.' },
      { status: 400 }
    );
  }

  const parsed = OnboardingActionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();

  if (parsed.data.action === 'check_channels') {
    if (!auth.telegram_id) {
      return NextResponse.json({ error: 'شناسه تلگرام معتبر یافت نشد.' }, { status: 403 });
    }
    const result = await verifyForcedChannelMembership(auth.telegram_id);
    if (result.allJoined) {
      db.prepare("UPDATE users SET channel_verified_at = datetime('now') WHERE id = ?").run(auth.id);
    }
    return NextResponse.json({
      ok: true,
      channelsVerified: result.allJoined,
      checkedByApi: result.checkedByApi,
      channels: result.channels,
      error: result.error || null,
    });
  }

  if (parsed.data.action === 'check_contact_status') {
    const row = db
      .prepare('SELECT phone_verified, onboarding_completed, phone_shared_at FROM users WHERE id = ?')
      .get(auth.id) as { phone_verified: number; onboarding_completed: number; phone_shared_at: string | null } | undefined;

    const verified = Boolean(row?.phone_verified);
    if (verified && !row?.onboarding_completed) {
      db.prepare('UPDATE users SET onboarding_completed = 1 WHERE id = ?').run(auth.id);
    }

    return NextResponse.json({
      ok: true,
      phoneShared: verified,
      onboardingCompleted: verified,
      message: verified ? 'شماره با موفقیت ثبت شد.' : 'در انتظار تأیید رسمی شماره از سمت تلگرام...',
    });
  }

  if (parsed.data.action === 'decline_contact') {
    return NextResponse.json({
      ok: true,
      phoneShared: Boolean(auth.phone_verified),
      message: 'اشتراک‌گذاری شماره انجام نشد. برای دسترسی کامل به مدار، هر زمان آماده بودید شماره خود را از طریق تلگرام به اشتراک بگذارید.',
    });
  }

  return NextResponse.json({ error: 'عملیات نامعتبر است.' }, { status: 400 });
}
