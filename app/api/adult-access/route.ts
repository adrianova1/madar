import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { calculateAge, getAuthUser } from '@/lib/security';

const AdultRequestSchema = z.object({
  consentAccepted: z.literal(true),
  verificationNote: z.string().min(4, 'توضیح کوتاه احراز هویت الزامی است').max(200),
});

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  const userRow = db
    .prepare(`
      SELECT u.phone_verified, p.birth_date, av.status, av.consent_accepted, av.reviewed_by, av.reviewed_at
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN adult_verifications av ON av.user_id = u.id
      WHERE u.id = ?
    `)
    .get(auth.id) as
    | {
        phone_verified: number;
        birth_date: string | null;
        status: 'unverified' | 'pending_review' | 'verified' | 'rejected' | null;
        consent_accepted: number | null;
        reviewed_by: string | null;
        reviewed_at: string | null;
      }
    | undefined;

  const age = calculateAge(userRow?.birth_date);
  const birthDateOver18 = age !== null && age >= 18;
  const phoneVerified = Boolean(userRow?.phone_verified);
  const status = userRow?.status ?? 'unverified';
  const consentAccepted = Boolean(userRow?.consent_accepted);

  // Strict server rule: self-entered birth date NEVER alone grants 18+ access.
  const isAdultContentAllowed =
    status === 'verified' && phoneVerified && birthDateOver18 && consentAccepted;

  return NextResponse.json({
    status,
    phoneVerified,
    birthDateOver18,
    consentAccepted,
    isAdultContentAllowed,
    reviewedBy: userRow?.reviewed_by ?? null,
    reviewedAt: userRow?.reviewed_at ?? null,
    policySummary:
      'صرف واردکردن تاریخ تولد برای دسترسی به بخش بزرگسالان ۱۸+ کافی نیست. تأیید شماره از طریق اشتراک‌گذاری رسمی تلگرام، پذیرش منشور رضایت آگاهانه و تأیید مدیریت الزامی است.',
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  const userRow = db
    .prepare(`
      SELECT u.phone_verified, p.birth_date
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = ?
    `)
    .get(auth.id) as { phone_verified: number; birth_date: string | null } | undefined;

  if (!userRow?.phone_verified) {
    return NextResponse.json(
      { error: 'ابتدا باید شماره خود را در مرحله ورود از طریق پنجره رسمی اشتراک‌گذاری شماره تلگرام تأیید کنید.' },
      { status: 403 }
    );
  }

  const age = calculateAge(userRow.birth_date);
  if (age === null || age < 18) {
    return NextResponse.json(
      { error: 'بر اساس تاریخ تولد ثبت‌شده، شرایط سنی ۱۸ سال احراز نشده است.' },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = AdultRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'پذیرش صریح منشور رضایت و تکمیل اطلاعات درخواست الزامی است.' },
      { status: 400 }
    );
  }

  db.prepare(`
    INSERT INTO adult_verifications (user_id, status, phone_confirmed, consent_accepted, verification_note, updated_at)
    VALUES (?, 'pending_review', 1, 1, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      status = 'pending_review',
      phone_confirmed = 1,
      consent_accepted = 1,
      verification_note = excluded.verification_note,
      updated_at = datetime('now')
  `).run(auth.id, parsed.data.verificationNote.trim());

  db.prepare(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'security', 'درخواست احراز سن ۱۸+ ثبت شد', 'درخواست شما در صف بررسی مدیریت مدار قرار گرفت. تا زمان تأیید نهایی، محتوای ۱۸+ قفل باقی می‌ماند.')"
  ).run(auth.id);

  return NextResponse.json({
    ok: true,
    status: 'pending_review',
    message:
      'درخواست احراز سن ۱۸+ و رضایت آگاهانه ثبت شد. پس از تأیید در پنل مدیریت مدار، دسترسی اختصاصی برای شما باز می‌شود.',
  });
}

export async function DELETE(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  db.prepare(
    "UPDATE adult_verifications SET status = 'unverified', consent_accepted = 0, updated_at = datetime('now') WHERE user_id = ?"
  ).run(auth.id);

  return NextResponse.json({
    ok: true,
    message: 'رضایت و دسترسی شما به بخش بزرگسالان ۱۸+ لغو و غیرفعال شد.',
  });
}
