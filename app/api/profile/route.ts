import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { calculateAge, getAuthUser, hashPassword } from '@/lib/security';

const ProfileUpdateSchema = z.object({
  displayName: z.string().min(2).max(40).optional(),
  gender: z.string().max(20).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  city: z.string().min(2).max(40).optional(),
  province: z.string().max(40).optional(),
  culturalBg: z.string().max(50).optional(),
  bio: z.string().max(260).optional(),
  interests: z.array(z.string().min(1).max(30)).max(12).optional(),
  relationshipStatus: z.string().max(30).optional(),
  goal: z.string().max(60).optional(),
  preferredConnection: z.string().max(60).optional(),
  favoritePlanet: z.string().max(20).optional(),
  equippedFrame: z.string().max(40).optional(),
  equippedBadge: z.string().max(40).optional(),
  hideCity: z.boolean().optional(),
  hideOnline: z.boolean().optional(),
  datingEnabled: z.boolean().optional(),
  allowWhispers: z.boolean().optional(),
  usePersonalityInMatching: z.boolean().optional(),
  newPassword: z.string().min(6).max(128).optional(),
  datingProfileAction: z.enum(['save', 'pause', 'resume', 'delete']).optional(),
  datingBio: z.string().max(260).optional(),
  lookingFor: z.string().max(80).optional(),
  datingMinAge: z.number().int().min(18).max(75).optional(),
  datingMaxAge: z.number().int().min(18).max(80).optional(),
  datingGenderPref: z.enum(['all', 'زن', 'مرد']).optional(),
  datingShowCity: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'اطلاعات پروفایل نامعتبر است.' }, { status: 400 });
  }

  const d = parsed.data;
  const db = getDb();

  // Verify equipped cosmetic ownership on server
  if (d.equippedFrame && d.equippedFrame !== 'none') {
    const owns = db.prepare('SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?').get(auth.id, d.equippedFrame);
    if (!owns) return NextResponse.json({ error: 'این قاب در فهرست آیتم‌های خریداری‌شده شما نیست.' }, { status: 403 });
  }
  if (d.equippedBadge && d.equippedBadge !== 'none') {
    const owns = db.prepare('SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?').get(auth.id, d.equippedBadge);
    if (!owns) return NextResponse.json({ error: 'این نشان در فهرست آیتم‌های خریداری‌شده شما نیست.' }, { status: 403 });
  }

  // Handle separate optional Venus Dating Profile lifecycle without affecting social/gaming identity
  if (d.datingProfileAction) {
    const currentProf = db.prepare('SELECT birth_date FROM user_profiles WHERE user_id = ?').get(auth.id) as
      | { birth_date: string | null }
      | undefined;
    const computedAge = calculateAge(d.birthDate ?? currentProf?.birth_date);

    if (d.datingProfileAction === 'delete') {
      db.transaction(() => {
        db.prepare('DELETE FROM dating_profiles WHERE user_id = ?').run(auth.id);
        db.prepare('UPDATE user_profiles SET dating_enabled = 0 WHERE user_id = ?').run(auth.id);
      })();
      return NextResponse.json({
        ok: true,
        message: 'پروفایل مستقل آشنایی ونوس حذف شد. حساب اجتماعی، بازی‌ها و ستاره‌های شما دست‌نخورده باقی ماندند.',
      });
    }

    if (d.datingProfileAction === 'pause') {
      db.transaction(() => {
        db.prepare("UPDATE dating_profiles SET is_active = 0, updated_at = datetime('now') WHERE user_id = ?").run(auth.id);
        db.prepare('UPDATE user_profiles SET dating_enabled = 0 WHERE user_id = ?').run(auth.id);
      })();
      return NextResponse.json({
        ok: true,
        message: 'پروفایل آشنایی ونوس موقتاً متوقف شد و به دیگران نمایش داده نمی‌شود.',
      });
    }

    if (computedAge === null || computedAge < 18) {
      return NextResponse.json(
        { error: 'ساخت یا فعال‌سازی پروفایل آشنایی ونوس فقط برای کاربران ۱۸ سال به بالا مجاز است.' },
        { status: 403 }
      );
    }

    if (d.datingProfileAction === 'resume') {
      db.transaction(() => {
        db.prepare("UPDATE dating_profiles SET is_active = 1, updated_at = datetime('now') WHERE user_id = ?").run(auth.id);
        db.prepare('UPDATE user_profiles SET dating_enabled = 1 WHERE user_id = ?').run(auth.id);
      })();
      return NextResponse.json({ ok: true, message: 'پروفایل آشنایی ونوس دوباره فعال شد.' });
    }

    // save / create optional dating profile
    db.transaction(() => {
      const existingDp = db.prepare('SELECT * FROM dating_profiles WHERE user_id = ?').get(auth.id) as
        | Record<string, unknown>
        | undefined;
      const minA = d.datingMinAge ?? Number(existingDp?.min_age ?? 18);
      const maxA = Math.max(minA, d.datingMaxAge ?? Number(existingDp?.max_age ?? 45));

      db.prepare(`
        INSERT INTO dating_profiles (user_id, is_active, dating_bio, looking_for, min_age, max_age, gender_pref, show_city, updated_at)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          is_active = 1,
          dating_bio = excluded.dating_bio,
          looking_for = excluded.looking_for,
          min_age = excluded.min_age,
          max_age = excluded.max_age,
          gender_pref = excluded.gender_pref,
          show_city = excluded.show_city,
          updated_at = datetime('now')
      `).run(
        auth.id,
        d.datingBio ?? String(existingDp?.dating_bio ?? ''),
        d.lookingFor ?? String(existingDp?.looking_for ?? 'آشنایی جدی و گفت‌وگوی عمیق'),
        minA,
        maxA,
        d.datingGenderPref ?? String(existingDp?.gender_pref ?? 'all'),
        d.datingShowCity !== undefined ? (d.datingShowCity ? 1 : 0) : Number(existingDp?.show_city ?? 1)
      );
      db.prepare('UPDATE user_profiles SET dating_enabled = 1 WHERE user_id = ?').run(auth.id);
    })();
    return NextResponse.json({
      ok: true,
      message: 'پروفایل مستقل آشنایی ونوس با موفقیت ذخیره و فعال شد.',
    });
  }

  db.transaction(() => {
    if (d.displayName !== undefined) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(d.displayName.trim(), auth.id);
      db.prepare('UPDATE user_profiles SET avatar_initials = ? WHERE user_id = ?').run(d.displayName.trim().slice(0, 2), auth.id);
    }
    if (d.allowWhispers !== undefined) {
      db.prepare('UPDATE users SET allow_whispers = ? WHERE id = ?').run(d.allowWhispers ? 1 : 0, auth.id);
    }
    if (d.newPassword) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(d.newPassword), auth.id);
    }

    const current = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(auth.id) as Record<string, unknown>;
    const nextBirthDate = d.birthDate ?? (current.birth_date as string | null);
    const computedAge = calculateAge(nextBirthDate);
    // Automatically disable dating for under-18 users
    const safeDatingEnabled = computedAge !== null && computedAge < 18 ? 0 : d.datingEnabled !== undefined ? (d.datingEnabled ? 1 : 0) : Number(current.dating_enabled);

    if (computedAge !== null && computedAge < 18) {
      db.prepare("UPDATE dating_profiles SET is_active = 0, updated_at = datetime('now') WHERE user_id = ?").run(auth.id);
    }

    db.prepare(`
      UPDATE user_profiles SET
        gender = ?,
        birth_date = ?,
        city = ?,
        province = ?,
        cultural_bg = ?,
        bio = ?,
        interests = ?,
        relationship_status = ?,
        goal = ?,
        preferred_connection = ?,
        favorite_planet = ?,
        equipped_frame = ?,
        equipped_badge = ?,
        hide_city = ?,
        hide_online = ?,
        dating_enabled = ?,
        use_personality_in_matching = ?,
        updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      d.gender ?? current.gender,
      nextBirthDate,
      d.city ?? current.city,
      d.province ?? current.province,
      d.culturalBg ?? current.cultural_bg,
      d.bio ?? current.bio,
      d.interests ? JSON.stringify(d.interests) : current.interests,
      d.relationshipStatus ?? current.relationship_status,
      d.goal ?? current.goal,
      d.preferredConnection ?? current.preferred_connection,
      d.favoritePlanet ?? current.favorite_planet,
      d.equippedFrame ?? current.equipped_frame,
      d.equippedBadge ?? current.equipped_badge,
      d.hideCity !== undefined ? (d.hideCity ? 1 : 0) : current.hide_city,
      d.hideOnline !== undefined ? (d.hideOnline ? 1 : 0) : current.hide_online,
      safeDatingEnabled,
      d.usePersonalityInMatching !== undefined ? (d.usePersonalityInMatching ? 1 : 0) : current.use_personality_in_matching,
      auth.id
    );
  })();

  return NextResponse.json({ ok: true, message: 'پروفایل اجتماعی و تنظیمات حریم خصوصی ذخیره شد.' });
}
