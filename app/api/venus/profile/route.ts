import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { calculateAge, getAuthUser } from '@/lib/security';

const DatingProfileSchema = z.object({
  isActive: z.boolean().default(true),
  datingBio: z.string().min(6, 'بیوگرافی بخش آشنایی باید حداقل ۶ کاراکتر باشد').max(260),
  lookingFor: z.string().min(2).max(80),
  minAge: z.number().int().min(18).max(80).default(18),
  maxAge: z.number().int().min(18).max(80).default(45),
  genderPref: z.enum(['all', 'زن', 'مرد']).default('all'),
  showCity: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  const dp = db.prepare('SELECT * FROM dating_profiles WHERE user_id = ?').get(auth.id) as
    | {
        user_id: number;
        is_active: number;
        dating_bio: string;
        looking_for: string;
        min_age: number;
        max_age: number;
        gender_pref: string;
        show_city: number;
        activated_at: string;
      }
    | undefined;

  return NextResponse.json({
    hasDatingProfile: Boolean(dp),
    datingProfile: dp
      ? {
          isActive: Boolean(dp.is_active),
          datingBio: dp.dating_bio,
          lookingFor: dp.looking_for,
          minAge: dp.min_age,
          maxAge: dp.max_age,
          genderPref: dp.gender_pref,
          showCity: Boolean(dp.show_city),
          activatedAt: dp.activated_at,
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  const profile = db.prepare('SELECT birth_date FROM user_profiles WHERE user_id = ?').get(auth.id) as
    | { birth_date: string | null }
    | undefined;
  const age = calculateAge(profile?.birth_date);
  if (age !== null && age < 18) {
    return NextResponse.json(
      { error: 'ساخت پروفایل آشنایی ونوس برای کاربران زیر ۱۸ سال مجاز نیست.' },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = DatingProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'اطلاعات پروفایل آشنایی نامعتبر است.' },
      { status: 400 }
    );
  }

  const d = parsed.data;
  if (d.minAge > d.maxAge) {
    return NextResponse.json({ error: 'حداقل سن نمی‌تواند بیشتر از حداکثر سن باشد.' }, { status: 400 });
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO dating_profiles (user_id, is_active, dating_bio, looking_for, min_age, max_age, gender_pref, show_city, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        is_active = excluded.is_active,
        dating_bio = excluded.dating_bio,
        looking_for = excluded.looking_for,
        min_age = excluded.min_age,
        max_age = excluded.max_age,
        gender_pref = excluded.gender_pref,
        show_city = excluded.show_city,
        updated_at = datetime('now')
    `).run(auth.id, d.isActive ? 1 : 0, d.datingBio.trim(), d.lookingFor.trim(), d.minAge, d.maxAge, d.genderPref, d.showCity ? 1 : 0);

    db.prepare('UPDATE user_profiles SET dating_enabled = ? WHERE user_id = ?').run(d.isActive ? 1 : 0, auth.id);
  })();

  return NextResponse.json({
    ok: true,
    message: d.isActive
      ? 'پروفایل مستقل آشنایی ونوس شما فعال شد.'
      : 'پروفایل آشنایی ونوس به‌صورت موقت متوقف شد (پروفایل بازی و اجتماعی شما همچنان فعال است).',
  });
}

export async function DELETE(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM dating_profiles WHERE user_id = ?').run(auth.id);
    db.prepare('UPDATE user_profiles SET dating_enabled = 0 WHERE user_id = ?').run(auth.id);
  })();

  return NextResponse.json({
    ok: true,
    message: 'پروفایل آشنایی ونوس شما حذف شد؛ حساب اجتماعی، ستاره‌ها و بازی‌های شما کاملاً دست‌نخورده باقی ماندند.',
  });
}
