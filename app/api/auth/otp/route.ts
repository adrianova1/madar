import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { checkRateLimit, getAuthUser, getClientIp, hashToken, normalizeIranPhone } from '@/lib/security';

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

async function dispatchRealSms(phone: string, code: string): Promise<{ delivered: boolean; error?: string }> {
  const apiKey = process.env.SMS_PROVIDER_API_KEY?.trim();
  const providerUrl = process.env.SMS_PROVIDER_URL?.trim();
  if (!apiKey || !providerUrl) {
    return { delivered: false, error: 'SMS_NOT_CONFIGURED' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(providerUrl);
    if (parsedUrl.protocol !== 'https:') {
      return { delivered: false, error: 'SMS_URL_MUST_BE_HTTPS' };
    }
  } catch {
    return { delivered: false, error: 'SMS_URL_INVALID' };
  }

  try {
    const res = await fetch(parsedUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        receptor: phone,
        message: `کد تأیید مدار: ${code}`,
        code,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { delivered: false, error: `SMS_GATEWAY_HTTP_${res.status}` };
    }
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'SMS_GATEWAY_UNREACHABLE' };
  }
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const ip = getClientIp(req);
  const body = await req.json().catch(() => null);
  const parsed = OtpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'ورودی نامعتبر است.' }, { status: 400 });
  }

  const normalized = normalizeIranPhone(parsed.data.phone);
  if (!normalized) {
    return NextResponse.json({ error: 'شماره موبایل معتبر ایران با +98 یا 09 وارد کنید.' }, { status: 400 });
  }

  const db = getDb();
  const isProd = process.env.NODE_ENV === 'production';

  if (parsed.data.step === 'request') {
    const ipRl = checkRateLimit(`otp_ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipRl.allowed) {
      return NextResponse.json(
        { error: `تعداد درخواست‌ها زیاد است. ${ipRl.retryAfterSec} ثانیه صبر کنید.` },
        { status: 429 }
      );
    }

    const rl = checkRateLimit(`otp_req:${auth.id}:${normalized}`, 3, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `سقف ارسال کد پر شده است. ${rl.retryAfterSec} ثانیه دیگر تلاش کنید.` },
        { status: 429 }
      );
    }

    const code = String(crypto.randomInt(100000, 999999));
    const codeHash = hashToken(`${normalized}:${code}`);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const smsResult = await dispatchRealSms(normalized, code);

    if (!smsResult.delivered) {
      if (isProd) {
        return NextResponse.json(
          {
            ok: false,
            smsProviderActive: false,
            error: 'سرویس ارسال پیامک روی سرور متصل نیست. امکان ارسال کد تأیید وجود ندارد.',
          },
          { status: 503 }
        );
      }

      // Non-production dev/test mode only: store OTP and explicitly indicate no real SMS was sent
      db.prepare(
        'INSERT INTO phone_verifications (user_id, phone, code_hash, expires_at) VALUES (?, ?, ?, ?)'
      ).run(auth.id, normalized, codeHash, expiresAt);

      return NextResponse.json({
        ok: true,
        phone: normalized,
        smsProviderActive: false,
        smsDelivered: false,
        sandboxOtpPreview: code,
        message: 'محیط توسعه: درگاه پیامکی متصل نیست و پیامکی ارسال نشده است. کد آزمایشی صرفاً برای تست نمایش داده شد.',
      });
    }

    db.prepare(
      'INSERT INTO phone_verifications (user_id, phone, code_hash, expires_at) VALUES (?, ?, ?, ?)'
    ).run(auth.id, normalized, codeHash, expiresAt);

    return NextResponse.json({
      ok: true,
      phone: normalized,
      smsProviderActive: true,
      smsDelivered: true,
      message: 'کد تأیید ۶ رقمی به شماره شما ارسال شد.',
    });
  }

  // Verify step
  const rlVerify = checkRateLimit(`otp_ver:${auth.id}:${ip}`, 8, 10 * 60 * 1000);
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
    return NextResponse.json({ error: 'کد به دلیل تلاش ناموفق منقضی شد. کد جدید بگیرید.' }, { status: 429 });
  }
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'مهلت کد تأیید تمام شده است.' }, { status: 400 });
  }

  const expectedHash = hashToken(`${normalized}:${parsed.data.code}`);
  const aBuf = Buffer.from(expectedHash, 'hex');
  const bBuf = Buffer.from(record.code_hash, 'hex');
  const matched = aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
  if (!matched) {
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
    message: 'شماره موبایل با موفقیت تأیید شد.',
  });
}
