import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adjustStarsAtomic, getDb } from '@/lib/db';
import { calculateAge, getAuthUser } from '@/lib/security';

const RecordGameSchema = z.object({
  gameType: z.enum(['quiz', 'truth_dare', 'mafia', 'hokm']),
  score: z.number().int().min(0).max(10000),
  result: z.string().min(2).max(60),
  won: z.boolean().default(false),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  const db = getDb();

  // Strict multi-layer 18+ verification: self-entered birth_date alone NEVER unlocks 18+ content
  let isAdultVerified = false;
  let adultAccessStatus: 'unverified' | 'pending_review' | 'verified' | 'rejected' = 'unverified';
  if (auth) {
    const row = db
      .prepare(`
        SELECT u.phone_verified, p.birth_date, av.status, av.consent_accepted
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
        }
      | undefined;
    const age = calculateAge(row?.birth_date);
    adultAccessStatus = row?.status ?? 'unverified';
    isAdultVerified =
      adultAccessStatus === 'verified' &&
      Boolean(row?.phone_verified) &&
      age !== null &&
      age >= 18 &&
      Boolean(row?.consent_accepted);
  }

  const category = req.nextUrl.searchParams.get('category')?.trim() || '';
  const quizRows = category && category !== 'همه'
    ? db.prepare('SELECT id, category, question, options_json, correct_index, difficulty FROM quiz_questions WHERE category = ? ORDER BY RANDOM() LIMIT 10').all(category)
    : db.prepare('SELECT id, category, question, options_json, correct_index, difficulty FROM quiz_questions ORDER BY RANDOM() LIMIT 10').all();

  const quizQuestions = (quizRows as { id: number; category: string; question: string; options_json: string; correct_index: number; difficulty: string }[]).map((q) => ({
    id: q.id,
    category: q.category,
    question: q.question,
    options: JSON.parse(q.options_json) as string[],
    correctIndex: q.correct_index,
    difficulty: q.difficulty,
  }));

  // Strict server-side 18+ filter for Truth or Dare prompts (requires full verified 18+ status + explicit consent)
  const tdPrompts = isAdultVerified
    ? db.prepare('SELECT id, mode, category, text, is_adult FROM truth_dare_prompts ORDER BY RANDOM()').all()
    : db.prepare('SELECT id, mode, category, text, is_adult FROM truth_dare_prompts WHERE is_adult = 0 ORDER BY RANDOM()').all();

  const leaderboard = db
    .prepare(`
      SELECT u.username, u.display_name, u.level,
             COALESCE(SUM(g.score), 0) as total_score,
             COUNT(g.id) as games_played
      FROM users u
      LEFT JOIN game_history g ON g.user_id = u.id
      WHERE u.is_deleted = 0 AND u.is_banned = 0
      GROUP BY u.id
      ORDER BY total_score DESC, u.xp DESC
      LIMIT 10
    `)
    .all();

  const myHistory = auth
    ? db
        .prepare('SELECT id, game_type, score, result, stars_earned, created_at FROM game_history WHERE user_id = ? ORDER BY id DESC LIMIT 12')
        .all(auth.id)
    : [];

  return NextResponse.json({
    isAdult: isAdultVerified,
    isAdultVerified,
    adultAccessStatus,
    quizQuestions,
    tdPrompts,
    leaderboard,
    myHistory,
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'برای ثبت رکورد و دریافت ستاره وارد حساب شوید.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = RecordGameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'اطلاعات نتیجه بازی نامعتبر است.' }, { status: 400 });
  }

  const d = parsed.data;
  const starsReward = d.won ? 20 : 8;
  const xpGain = d.won ? 40 : 15;

  const db = getDb();
  const wallet = db.transaction(() => {
    db.prepare(
      'INSERT INTO game_history (user_id, game_type, score, result, stars_earned, meta_json) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(auth.id, d.gameType, d.score, d.result, starsReward, JSON.stringify(d.meta ?? {}));

    db.prepare('UPDATE users SET xp = xp + ?, level = 1 + ((xp + ?) / 150) WHERE id = ?').run(xpGain, xpGain, auth.id);

    return adjustStarsAtomic(
      auth.id,
      starsReward,
      'free',
      'game_reward',
      `پاداش بازی ${d.gameType === 'hokm' ? 'حکم' : d.gameType === 'mafia' ? 'مافیا' : d.gameType === 'quiz' ? 'کوییز عطارد' : 'جرئت و حقیقت'}`
    );
  })();

  return NextResponse.json({
    ok: true,
    starsEarned: starsReward,
    wallet,
    message: `نتیجه بازی ثبت شد و +${starsReward} ستاره دریافت کردی!`,
  });
}
