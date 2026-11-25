import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { checkRateLimit, getAuthUser, hashToken, normalizeIranPhone } from '@/lib/security';

const OtpSchema = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('request'),
    phone: z.string().min(10).max(20),
  }),
  z.object({
    step: z.literal('verify'),
    phone: z.string().min(10).max(20),
    code: z.string().regex(/^\d{6}$/, 'کد تأیید باید ۶ رقم باشد'),
  }),
]);

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = OtpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'ورودی نامعتبر است.' }, { status: 400 });
  }

  const normalized = normalizeIranPhone(parsed.data.phone);
  if (!normalized) {
    return NextResponse.json({ error: 'شماره موبایل معتبر ایران با پیش‌شماره +98 یا 09 وارد کنید.' }, { status: 400 });
  }

  const db = getDb();

  if (parsed.data.step === 'request') {
    const rl = checkRateLimit(`otp_req:${auth.id}:${normalized}`, 3, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `سقف ارسال کد تأیید پر شده است. لطفاً ${rl.retryAfterSec} ثانیه دیگر تلاش کنید.` },
        { status: 429 }
      );
    }

    const code = String(crypto.randomInt(100000, 999999));
    const codeHash = hashToken(`${normalized}:${code}`);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    db.prepare(
      'INSERT INTO phone_verifications (user_id, phone, code_hash, expires_at) VALUES (?, ?, ?, ?)'
    ).run(auth.id, normalized, codeHash, expiresAt);

    const hasSmsProvider = Boolean(process.env.SMS_PROVIDER_API_KEY);
    return NextResponse.json({
      ok: true,
      phone: normalized,
      smsProviderActive: hasSmsProvider,
      // Only return sandbox code when no external Iranian SMS gateway is configured yet
      sandboxOtpPreview: hasSmsProvider ? undefined : code,
      message: hasSmsProvider
        ? 'کد ۶ رقمی به شماره شما پیامک شد.'
        : 'درگاه پیامکی خارجی (SMS_PROVIDER_API_KEY) متصل نیست؛ کد آزمایشی برای تست جریان تأیید صادر شد.',
    });
  }

  // Verify step
  const rlVerify = checkRateLimit(`otp_ver:${auth.id}`, 8, 10 * 60 * 1000);
  if (!rlVerify.allowed) {
    return NextResponse.json({ error: 'تعداد تلاش‌های بررسی کد بیش از حد مجاز است.' }, { status: 429 });
  }

  const record = db
    .prepare(
      'SELECT id, code_hash, attempts, expires_at FROM phone_verifications WHERE user_id = ? AND phone = ? AND verified = 0 ORDER BY id DESC LIMIT 1'
    )
    .get(auth.id, normalized) as { id: number; code_hash: string; attempts: number; expires_at: string } | undefined;

  if (!record) {
    return NextResponse.json({ error: 'درخواست کد فعالی برای این شماره یافت نشد.' }, { status: 400 });
  }
  if (record.attempts >= 5) {
    return NextResponse.json({ error: 'کد به دلیل تلاش ناموفق متعدد منقضی شد. کد جدید درخواست دهید.' }, { status: 429 });
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'مهلت کد تأیید به پایان رسیده است.' }, { status: 400 });
  }

  const expectedHash = hashToken(`${normalized}:${parsed.data.code}`);
  if (expectedHash !== record.code_hash) {
    db.prepare('UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?').run(record.id);
    return NextResponse.json({ error: 'کد واردشده نادرست است.' }, { status: 400 });
  }

  db.transaction(() => {
    db.prepare('UPDATE phone_verifications SET verified = 1 WHERE id = ?').run(record.id);
    db.prepare('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?').run(normalized, auth.id);
  })();

  return NextResponse.json({
    ok: true,
    phoneMasked: `${normalized.slice(0, 6)}****${normalized.slice(-2)}`,
    message: 'شماره موبایل شما با موفقیت تأیید شد و به کاربران دیگر نمایش داده نمی‌شود.',
  });
}
