import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { calculateAge, getAuthUser } from '@/lib/security';
import { computeCompatibility } from '@/lib/personality-data';

const VenusActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['like', 'superlike', 'pass', 'favorite', 'intro']),
    targetUserId: z.number().int().positive(),
    introNote: z.string().max(180).optional(),
  }),
  z.object({
    type: z.literal('send_message'),
    matchId: z.number().int().positive(),
    content: z.string().min(1).max(600),
  }),
  z.object({
    type: z.literal('unmatch'),
    matchId: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('block'),
    targetUserId: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('report'),
    targetUserId: z.number().int().positive(),
    reason: z.string().min(3).max(200),
  }),
]);

function buildTasteProfile(db: ReturnType<typeof getDb>, userId: number) {
  const rows = db
    .prepare(
      'SELECT signal_type, weight, target_interests_json, target_goal, target_city FROM user_taste_signals WHERE user_id = ? ORDER BY id DESC LIMIT 80'
    )
    .all(userId) as {
      signal_type: string;
      weight: number;
      target_interests_json: string;
      target_goal: string;
      target_city: string;
    }[];

  const interestWeights = new Map<string, number>();
  const goalWeights = new Map<string, number>();
  const cityWeights = new Map<string, number>();

  for (const r of rows) {
    const interests = JSON.parse(r.target_interests_json || '[]') as string[];
    for (const interest of interests) {
      interestWeights.set(interest, (interestWeights.get(interest) ?? 0) + r.weight);
    }
    if (r.target_goal) {
      goalWeights.set(r.target_goal, (goalWeights.get(r.target_goal) ?? 0) + r.weight);
    }
    if (r.target_city) {
      cityWeights.set(r.target_city, (cityWeights.get(r.target_city) ?? 0) + r.weight * 0.5);
    }
  }

  return { signalCount: rows.length, interestWeights, goalWeights, cityWeights };
}

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  const me = db
    .prepare('SELECT birth_date, city, interests, goal, dating_enabled, use_personality_in_matching FROM user_profiles WHERE user_id = ?')
    .get(auth.id) as
    | {
        birth_date: string | null;
        city: string;
        interests: string;
        goal: string;
        dating_enabled: number;
        use_personality_in_matching: number;
      }
    | undefined;

  const myAge = calculateAge(me?.birth_date);
  if (myAge === null || myAge < 18) {
    return NextResponse.json({
      ageRestricted: true,
      datingProfileRequired: false,
      error: 'برای دسترسی به بخش آشنایی ونوس ثبت تاریخ تولد معتبر و سن حداقل ۱۸ سال الزامی است.',
      candidates: [],
      matches: [],
      favorites: [],
    });
  }

  // Separate Dating Profile check: social/gaming users do NOT have to opt into Venus
  const myDatingProfile = db
    .prepare('SELECT is_active, dating_bio, looking_for, min_age, max_age, gender_pref, show_city FROM dating_profiles WHERE user_id = ?')
    .get(auth.id) as
    | {
        is_active: number;
        dating_bio: string;
        looking_for: string;
        min_age: number;
        max_age: number;
        gender_pref: string;
        show_city: number;
      }
    | undefined;

  if (!myDatingProfile || !myDatingProfile.is_active) {
    return NextResponse.json({
      ageRestricted: false,
      datingProfileRequired: true,
      datingProfilePaused: Boolean(myDatingProfile && !myDatingProfile.is_active),
      datingEnabled: false,
      candidates: [],
      matches: [],
      favorites: [],
    });
  }

  const cityFilter = req.nextUrl.searchParams.get('city')?.trim() || '';
  const matchIdParam = Number(req.nextUrl.searchParams.get('matchId') || 0);

  // If requesting messages of a specific match, verify membership strictly
  if (matchIdParam > 0) {
    const matchRow = db
      .prepare("SELECT id, user_a_id, user_b_id FROM matches WHERE id = ? AND status = 'active'")
      .get(matchIdParam) as { id: number; user_a_id: number; user_b_id: number } | undefined;
    if (!matchRow || (matchRow.user_a_id !== auth.id && matchRow.user_b_id !== auth.id)) {
      return NextResponse.json({ error: 'دسترسی به این گفت‌وگو مجاز نیست.' }, { status: 403 });
    }
    const messages = db
      .prepare('SELECT id, sender_id, content, created_at FROM messages WHERE match_id = ? ORDER BY id ASC LIMIT 100')
      .all(matchIdParam);
    return NextResponse.json({ messages });
  }

  // Gather my personality answers & taste learning profile
  const myAnsRows = db
    .prepare('SELECT dimension_key, answer_value FROM personality_answers WHERE user_id = ? AND include_in_matching = 1')
    .all(auth.id) as { dimension_key: string; answer_value: number }[];
  const myAnsMap: Record<string, number> = {};
  if (me?.use_personality_in_matching) {
    for (const r of myAnsRows) myAnsMap[r.dimension_key] = r.answer_value;
  }

  const taste = buildTasteProfile(db, auth.id);
  const myProfile = {
    city: me?.city || '',
    interests: JSON.parse(me?.interests || '[]') as string[],
    goal: myDatingProfile.looking_for || me?.goal || '',
  };

  // Query eligible adult profiles who explicitly opted into separated dating_profiles
  const rawCandidates = db
    .prepare(`
      SELECT u.id, u.username, u.display_name, u.subscription_tier, u.phone_verified, u.last_active_at,
             p.avatar_color, p.avatar_initials, p.gender, p.birth_date, p.city, p.bio,
             p.interests, p.goal, p.hide_city, p.hide_online, p.equipped_frame,
             dp.dating_bio, dp.looking_for, dp.show_city as dp_show_city
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      JOIN dating_profiles dp ON dp.user_id = u.id
      WHERE u.id != ?
        AND u.is_banned = 0
        AND u.is_deleted = 0
        AND dp.is_active = 1
        AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
        AND u.id NOT IN (SELECT to_user_id FROM likes WHERE from_user_id = ? AND action IN ('like', 'pass'))
      ORDER BY u.last_active_at DESC
      LIMIT 30
    `)
    .all(auth.id, auth.id, auth.id, auth.id) as Record<string, unknown>[];

  const candidates = [];
  for (const c of rawCandidates) {
    const cAge = calculateAge(c.birth_date as string | null);
    if (cAge === null || cAge < 18) continue;
    if (cAge < myDatingProfile.min_age || cAge > myDatingProfile.max_age) continue;
    if (cityFilter && String(c.city) !== cityFilter) continue;

    const cInterests = JSON.parse(String(c.interests || '[]')) as string[];
    const cAnsRows = db
      .prepare('SELECT dimension_key, answer_value, answer_label FROM personality_answers WHERE user_id = ? AND include_in_matching = 1')
      .all(Number(c.id)) as { dimension_key: string; answer_value: number; answer_label: string }[];
    const cAnsMap: Record<string, number> = {};
    for (const r of cAnsRows) cAnsMap[r.dimension_key] = r.answer_value;

    const candidateGoal = String(c.looking_for || c.goal || '');
    const comp = computeCompatibility(
      myProfile,
      myAnsMap,
      { city: String(c.city || ''), interests: cInterests, goal: candidateGoal },
      cAnsMap
    );

    // Explainable Taste Learning adjustment (-6 to +8 bounded)
    let rawTasteScore = 0;
    const learnedMatches: string[] = [];
    for (const interest of cInterests) {
      const w = taste.interestWeights.get(interest) ?? 0;
      rawTasteScore += w;
      if (w >= 1.2) learnedMatches.push(interest);
    }
    rawTasteScore += (taste.goalWeights.get(candidateGoal) ?? 0) * 0.7;
    const tasteBoost = Math.max(-6, Math.min(8, Math.round(rawTasteScore * 1.5)));
    const adjustedScore = Math.max(45, Math.min(98, comp.score + tasteBoost));

    const matchReasons = [...comp.reasons];
    if (learnedMatches.length > 0) {
      matchReasons.unshift(`پیشنهاد بر اساس سلیقه تعاملات قبلی تو (${learnedMatches.slice(0, 2).join('، ')})`);
    }

    const hideCity = Boolean(Number(c.hide_city)) || !Boolean(Number(c.dp_show_city ?? 1));
    candidates.push({
      id: Number(c.id),
      username: String(c.username),
      displayName: String(c.display_name),
      subscriptionTier: String(c.subscription_tier),
      phoneVerified: Boolean(c.phone_verified),
      avatarColor: String(c.avatar_color),
      avatarInitials: String(c.avatar_initials),
      equippedFrame: String(c.equipped_frame || 'none'),
      age: cAge ?? 25,
      gender: String(c.gender),
      city: hideCity ? 'شهر مخفی' : String(c.city),
      isOnlineVisible: !Number(c.hide_online),
      bio: String(c.dating_bio || c.bio || ''),
      goal: candidateGoal,
      interests: cInterests,
      traits: cAnsRows.slice(0, 3).map((r) => r.answer_label),
      compatibilityScore: adjustedScore,
      tasteBoost,
      isEstimatedCompatibility: true,
      sharedInterests: comp.sharedInterests,
      matchReasons,
    });
  }

  candidates.sort((a, b) => b.compatibilityScore - a.compatibilityScore);

  const matches = db
    .prepare(`
      SELECT m.id as match_id, m.compatibility_score, m.created_at,
             u.id as partner_id, u.display_name, u.username,
             p.avatar_color, p.avatar_initials, p.city, p.hide_city
      FROM matches m
      JOIN users u ON u.id = CASE WHEN m.user_a_id = ? THEN m.user_b_id ELSE m.user_a_id END
      JOIN user_profiles p ON p.user_id = u.id
      WHERE (m.user_a_id = ? OR m.user_b_id = ?) AND m.status = 'active'
      ORDER BY m.id DESC
    `)
    .all(auth.id, auth.id, auth.id);

  const favorites = db
    .prepare(`
      SELECT u.id, u.display_name, u.username, p.avatar_initials, p.avatar_color, p.city, p.hide_city
      FROM likes l
      JOIN users u ON u.id = l.to_user_id
      JOIN user_profiles p ON p.user_id = u.id
      WHERE l.from_user_id = ? AND l.action = 'favorite'
      ORDER BY l.id DESC
    `)
    .all(auth.id);

  const topLearnedInterests = [...taste.interestWeights.entries()]
    .filter(([, w]) => w > 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k);

  return NextResponse.json({
    ageRestricted: false,
    datingProfileRequired: false,
    datingEnabled: true,
    tasteSummary: {
      signalsLearned: taste.signalCount,
      topLearnedInterests,
    },
    candidates,
    matches,
    favorites,
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = VenusActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();
  const data = parsed.data;

  // Enforce 18+ gate on dating actions
  const me = db.prepare('SELECT birth_date FROM user_profiles WHERE user_id = ?').get(auth.id) as
    | { birth_date: string | null }
    | undefined;
  const age = calculateAge(me?.birth_date);
  if (age === null || age < 18) {
    return NextResponse.json({ error: 'دسترسی به بخش آشنایی ونوس فقط با تاریخ تولد معتبر بالای ۱۸ سال مجاز است.' }, { status: 403 });
  }

  if (data.type === 'like' || data.type === 'superlike' || data.type === 'pass' || data.type === 'favorite' || data.type === 'intro') {
    if (data.targetUserId === auth.id) {
      return NextResponse.json({ error: 'امکان ثبت این عملیات روی حساب خودتان وجود ندارد.' }, { status: 400 });
    }

    const storedAction = data.type === 'superlike' ? 'like' : data.type;
    const storedNote = data.type === 'superlike' ? '[SUPERLIKE]' : data.introNote ?? '';
    const signalWeight =
      data.type === 'superlike'
        ? 2.4
        : data.type === 'like' || data.type === 'intro'
          ? 1.5
          : data.type === 'favorite'
            ? 1.2
            : -0.9;

    const targetProf = db
      .prepare('SELECT interests, goal, city FROM user_profiles WHERE user_id = ?')
      .get(data.targetUserId) as { interests: string; goal: string; city: string } | undefined;

    const result = db.transaction(() => {
      db.prepare(`
        INSERT INTO likes (from_user_id, to_user_id, action, intro_note)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(from_user_id, to_user_id) DO UPDATE SET action = excluded.action, intro_note = excluded.intro_note
      `).run(auth.id, data.targetUserId, storedAction, storedNote);

      if (targetProf) {
        db.prepare(`
          INSERT INTO user_taste_signals (user_id, target_user_id, signal_type, weight, target_interests_json, target_goal, target_city)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          auth.id,
          data.targetUserId,
          data.type,
          signalWeight,
          targetProf.interests || '[]',
          targetProf.goal || '',
          targetProf.city || ''
        );
      }

      if (data.type === 'superlike') {
        db.prepare(
          "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'superlike', 'علاقه ویژه در ونوس!', 'یک نفر در ونوس برای پروفایل تو Super Like ارسال کرد.')"
        ).run(data.targetUserId);
      }

      if (storedAction === 'like' || storedAction === 'intro') {
        const reciprocal = db
          .prepare("SELECT id FROM likes WHERE from_user_id = ? AND to_user_id = ? AND action IN ('like', 'intro')")
          .get(data.targetUserId, auth.id);

        if (reciprocal) {
          const [a, b] = auth.id < data.targetUserId ? [auth.id, data.targetUserId] : [data.targetUserId, auth.id];
          db.prepare(`
            INSERT INTO matches (user_a_id, user_b_id, compatibility_score, status)
            VALUES (?, ?, 88, 'active')
            ON CONFLICT(user_a_id, user_b_id) DO UPDATE SET status = 'active'
          `).run(a, b);

          const mRow = db.prepare('SELECT id FROM matches WHERE user_a_id = ? AND user_b_id = ?').get(a, b) as { id: number };
          db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'match', 'مچینگ جدید در ونوس!', 'علاقه‌مندی دوطرفه ثبت شد. اکنون می‌توانید گفت‌وگو را شروع کنید.')").run(auth.id);
          db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'match', 'مچینگ جدید در ونوس!', 'یک نفر که به او علاقه‌مند بودی، به تو علاقه نشان داد.')").run(data.targetUserId);

          return { matched: true, matchId: mRow.id };
        }
      }

      return { matched: false };
    })();

    return NextResponse.json({ ok: true, ...result });
  }

  if (data.type === 'send_message') {
    const matchRow = db
      .prepare("SELECT id, user_a_id, user_b_id FROM matches WHERE id = ? AND status = 'active'")
      .get(data.matchId) as { id: number; user_a_id: number; user_b_id: number } | undefined;
    if (!matchRow || (matchRow.user_a_id !== auth.id && matchRow.user_b_id !== auth.id)) {
      return NextResponse.json({ error: 'دسترسی به این گفت‌وگو مجاز نیست.' }, { status: 403 });
    }
    const res = db
      .prepare('INSERT INTO messages (match_id, sender_id, content) VALUES (?, ?, ?)')
      .run(data.matchId, auth.id, data.content.trim());
    return NextResponse.json({ ok: true, messageId: Number(res.lastInsertRowid) });
  }

  if (data.type === 'unmatch') {
    db.prepare(
      "UPDATE matches SET status = 'unmatched' WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)"
    ).run(data.matchId, auth.id, auth.id);
    return NextResponse.json({ ok: true, message: 'مچینگ با موفقیت لغو شد.' });
  }

  if (data.type === 'block') {
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(auth.id, data.targetUserId);
      const [a, b] = auth.id < data.targetUserId ? [auth.id, data.targetUserId] : [data.targetUserId, auth.id];
      db.prepare("UPDATE matches SET status = 'unmatched' WHERE user_a_id = ? AND user_b_id = ?").run(a, b);
    })();
    return NextResponse.json({ ok: true, message: 'کاربر بلاک شد و دیگر نمایش داده نمی‌شود.' });
  }

  if (data.type === 'report') {
    db.prepare("INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, 'user', ?, ?)").run(
      auth.id,
      String(data.targetUserId),
      data.reason.trim()
    );
    return NextResponse.json({ ok: true, message: 'گزارش شما در صف بررسی مدیریت ثبت شد.' });
  }

  return NextResponse.json({ error: 'عملیات ناشناخته' }, { status: 400 });
}
