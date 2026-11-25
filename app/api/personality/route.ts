import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adjustStarsAtomic, getDb } from '@/lib/db';
import { getAuthUser } from '@/lib/security';
import { PERSONALITY_QUESTIONS } from '@/lib/personality-data';

const SaveAnswerSchema = z.object({
  questionId: z.string().min(1),
  answerValue: z.number().int().min(1).max(5),
  includeInMatching: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  const rows = db
    .prepare(
      'SELECT question_id, dimension_key, answer_value, answer_label, include_in_matching FROM personality_answers WHERE user_id = ?'
    )
    .all(auth.id) as {
    question_id: string;
    dimension_key: string;
    answer_value: number;
    answer_label: string;
    include_in_matching: number;
  }[];

  const answersMap: Record<string, { value: number; label: string; includeInMatching: boolean }> = {};
  for (const r of rows) {
    answersMap[r.question_id] = {
      value: r.answer_value,
      label: r.answer_label,
      includeInMatching: Boolean(r.include_in_matching),
    };
  }

  const completionPercent = Math.round((rows.length / PERSONALITY_QUESTIONS.length) * 100);
  return NextResponse.json({
    questions: PERSONALITY_QUESTIONS,
    answers: answersMap,
    completedCount: rows.length,
    totalCount: PERSONALITY_QUESTIONS.length,
    completionPercent,
    disclaimer:
      'نتایج این آزمون صرفاً برای شناخت ترجیحات ارتباطی و پیشنهاد سازگاری بهتر در مدار است و هیچ‌گونه تشخیص روان‌شناختی یا بالینی محسوب نمی‌شود.',
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = SaveAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'پاسخ ارسالی نامعتبر است.' }, { status: 400 });
  }

  const qDef = PERSONALITY_QUESTIONS.find((q) => q.id === parsed.data.questionId);
  if (!qDef) return NextResponse.json({ error: 'سؤال موردنظر یافت نشد.' }, { status: 404 });

  const opt = qDef.options.find((o) => o.value === parsed.data.answerValue);
  if (!opt) return NextResponse.json({ error: 'گزینه انتخاب‌شده نامعتبر است.' }, { status: 400 });

  const db = getDb();
  db.prepare(`
    INSERT INTO personality_answers (user_id, dimension_key, question_id, answer_value, answer_label, include_in_matching, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, question_id) DO UPDATE SET
      answer_value = excluded.answer_value,
      answer_label = excluded.answer_label,
      include_in_matching = excluded.include_in_matching,
      updated_at = datetime('now')
  `).run(auth.id, qDef.dimensionKey, qDef.id, opt.value, opt.label, parsed.data.includeInMatching ? 1 : 0);

  const count = (
    db.prepare('SELECT COUNT(*) as c FROM personality_answers WHERE user_id = ?').get(auth.id) as { c: number }
  ).c;

  let rewarded = false;
  if (count === PERSONALITY_QUESTIONS.length) {
    const alreadyRewarded = db
      .prepare("SELECT 1 FROM star_transactions WHERE user_id = ? AND tx_type = 'personality_complete'")
      .get(auth.id);
    if (!alreadyRewarded) {
      adjustStarsAtomic(auth.id, 40, 'free', 'personality_complete', 'پاداش تکمیل کامل آزمون شخصیت و سازگاری');
      rewarded = true;
    }
  }

  return NextResponse.json({
    ok: true,
    completedCount: count,
    completionPercent: Math.round((count / PERSONALITY_QUESTIONS.length) * 100),
    rewarded,
  });
}
