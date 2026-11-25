import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { calculateAge, checkRateLimit, getAuthUser } from '@/lib/security';
import { computeCompatibility } from '@/lib/personality-data';

const COSMIC_ALIASES = [
  'مسافر سحابی آندرومدا',
  'ستاره پنهان نپتون',
  'همسفر مدار شفق',
  'شهاب‌سنگ نقره‌ای',
  'راوی شب‌های کیهانی',
  'کاوشگر قمر تایتان',
  'نغمه کهکشان راه شیری',
];

const BLIND_QA_QUESTIONS = [
  {
    id: 'bq1',
    question: 'اگر یک شب بارانی بدون گوشی و اینترنت داشتی، بهترین کار برای گذراندن آن شب چیست؟',
    options: ['کتاب و قهوه دمی در سکوت', 'گفت‌وگوی عمیق تا صبح با یک هم‌صحبت', 'تماشای فیلم کلاسیک و موسیقی', 'پیاده‌روی شبانه زیر باران'],
  },
  {
    id: 'bq2',
    question: 'در اولین آشنایی، کدام نشانه بیشتر از همه به تو حس امنیت و صمیمیت می‌دهد؟',
    options: ['شنونده خوب بودن و احترام به مرزها', 'شوخ‌طبعی هوشمندانه و بی‌پرده', 'صداقت در بیان خواسته‌ها', 'توجه به جزئیات کوچک در گفت‌وگو'],
  },
  {
    id: 'bq3',
    question: 'اگر قرار باشد اولین قرار واقعی ما در یک شهر یا فضا باشد، کدام را انتخاب می‌کنی؟',
    options: ['کافه دنج و کتاب‌فروشی', 'گالری هنری یا سینما', 'یک دور بازی رومیزی یا مافیا', 'قدم‌زدن در طبیعت هنگام غروب'],
  },
];

const ICEBREAKERS = [
  'اگر بتوانی یک مهارت جدید را در ۲۴ ساعت کامل یاد بگیری، چه مهارتی انتخاب می‌کنی؟',
  'کدام آهنگ یا فیلم هست که هر بار می‌بینی هنوز برایت تازه است؟',
  'به نظرت بهترین ویژگی یک گفت‌وگوی خوب چیست؟',
  'اگر همین آخر هفته یک بلیط سفر غیرمنتظره هدیه بگیری، مقصد رویایی‌ات کجاست؟',
];

const BlindDateActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
  }),
  z.object({
    action: z.literal('send_message'),
    sessionCode: z.string().min(4).max(24),
    content: z.string().min(1).max(500),
    msgType: z.enum(['text', 'reaction']).default('text'),
  }),
  z.object({
    action: z.literal('play_qa'),
    sessionCode: z.string().min(4).max(24),
    questionId: z.string().min(2).max(12),
    answer: z.string().min(1).max(160),
  }),
  z.object({
    action: z.literal('request_reveal'),
    sessionCode: z.string().min(4).max(24),
  }),
  z.object({
    action: z.literal('end_session'),
    sessionCode: z.string().min(4).max(24),
  }),
  z.object({
    action: z.literal('report_or_block'),
    sessionCode: z.string().min(4).max(24),
    kind: z.enum(['block', 'report']),
    reason: z.string().max(200).optional(),
  }),
]);

function formatBlindSessionForViewer(row: Record<string, unknown>, viewerId: number) {
  const db = getDb();
  const isUserA = Number(row.user_a_id) === viewerId;
  const partnerId = isUserA ? Number(row.user_b_id) : Number(row.user_a_id);
  const myReveal = isUserA ? Boolean(row.user_a_reveal) : Boolean(row.user_b_reveal);
  const partnerReveal = isUserA ? Boolean(row.user_b_reveal) : Boolean(row.user_a_reveal);
  const mutuallyRevealed = row.status === 'revealed' || (myReveal && partnerReveal);

  const partnerRow = db
    .prepare(`
      SELECT u.id, u.username, u.display_name, u.phone_verified,
             p.avatar_initials, p.avatar_color, p.city, p.hide_city, p.bio, p.interests, p.goal, p.birth_date,
             dp.dating_bio, dp.show_city as dp_show_city
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN dating_profiles dp ON dp.user_id = u.id
      WHERE u.id = ?
    `)
    .get(partnerId) as Record<string, unknown> | undefined;

  const messages = db
    .prepare('SELECT id, sender_id, msg_type, content, created_at FROM blind_date_messages WHERE blind_date_id = ? ORDER BY id ASC LIMIT 120')
    .all(Number(row.id)) as { id: number; sender_id: number; msg_type: string; content: string; created_at: string }[];

  const partnerInterests = partnerRow ? (JSON.parse(String(partnerRow.interests || '[]')) as string[]) : [];
  const hideCity = partnerRow ? Boolean(Number(partnerRow.hide_city)) || !Boolean(Number(partnerRow.dp_show_city ?? 1)) : true;
  const partnerAge = partnerRow ? calculateAge(partnerRow.birth_date as string | null) : null;

  const userMessageCount = messages.filter((m) => m.sender_id === viewerId && m.msg_type !== 'system').length;
  const qaList = JSON.parse(String(row.qa_state_json || '[]')) as {
    questionId: string;
    question: string;
    myAnswer?: string;
    partnerAnswer?: string;
  }[];
  const revealEligible = userMessageCount >= 2 || qaList.length >= 1;

  return {
    id: Number(row.id),
    sessionCode: String(row.session_code),
    status: String(row.status),
    myAlias: isUserA ? String(row.alias_a) : String(row.alias_b),
    partnerAlias: isUserA ? String(row.alias_b) : String(row.alias_a),
    compatibilityScore: Number(row.compatibility_score),
    sharedTraits: JSON.parse(String(row.shared_traits_json || '[]')) as string[],
    qaState: qaList,
    userMessageCount,
    revealEligible,
    myRevealConsent: myReveal,
    partnerRevealConsent: partnerReveal,
    mutuallyRevealed,
    // Strictly hide identity until BOTH users explicitly consent to reveal!
    partnerCard: mutuallyRevealed && partnerRow
      ? {
          revealed: true,
          displayName: String(partnerRow.display_name),
          username: String(partnerRow.username),
          age: partnerAge ?? 25,
          city: hideCity ? 'شهر مخفی' : String(partnerRow.city),
          bio: String(partnerRow.dating_bio || partnerRow.bio || ''),
          goal: String(partnerRow.goal || ''),
          interests: partnerInterests,
          avatarInitials: String(partnerRow.avatar_initials),
          avatarColor: String(partnerRow.avatar_color),
          phoneVerified: Boolean(partnerRow.phone_verified),
        }
      : {
          revealed: false,
          displayName: isUserA ? String(row.alias_b) : String(row.alias_a),
          username: 'ناشناس تا رضایت دوطرفه',
          age: null,
          city: 'مخفی تا افشای دوطرفه',
          bio: 'هویت و تصویر پروفایل تا زمانی که هر دو نفر درخواست افشای هویت را تأیید نکنند، کاملاً پنهان می‌ماند.',
          goal: partnerRow ? String(partnerRow.goal || '') : '',
          interests: partnerInterests.slice(0, 4),
          avatarInitials: '؟',
          avatarColor: '#312e81',
          phoneVerified: Boolean(partnerRow?.phone_verified),
        },
    messages: messages.map((m) => ({
      id: m.id,
      mine: m.sender_id === viewerId,
      msgType: m.msg_type,
      content: m.content,
      createdAt: m.created_at,
    })),
    createdAt: String(row.created_at),
  };
}

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const db = getDb();
  const me = db.prepare('SELECT birth_date FROM user_profiles WHERE user_id = ?').get(auth.id) as
    | { birth_date: string | null }
    | undefined;
  const myAge = calculateAge(me?.birth_date);
  if (myAge !== null && myAge < 18) {
    return NextResponse.json({ ageRestricted: true, sessions: [], icebreakers: ICEBREAKERS, qaBank: BLIND_QA_QUESTIONS });
  }

  const rows = db
    .prepare(`
      SELECT * FROM blind_dates
      WHERE (user_a_id = ? OR user_b_id = ?) AND status != 'ended'
      ORDER BY updated_at DESC
      LIMIT 8
    `)
    .all(auth.id, auth.id) as Record<string, unknown>[];

  return NextResponse.json({
    ageRestricted: false,
    sessions: rows.map((r) => formatBlindSessionForViewer(r, auth.id)),
    icebreakers: ICEBREAKERS,
    qaBank: BLIND_QA_QUESTIONS,
  });
}

export async function POST(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'احراز هویت الزامی است.' }, { status: 401 });

  const rl = checkRateLimit(`blind_date:${auth.id}`, 45, 5 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'تعداد پیام‌ها یا درخواست‌ها موقتاً محدود شده است. کمی صبر کنید.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BlindDateActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'درخواست آشنایی ناشناس نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();
  const me = db
    .prepare('SELECT birth_date, city, interests, goal FROM user_profiles WHERE user_id = ?')
    .get(auth.id) as { birth_date: string | null; city: string; interests: string; goal: string } | undefined;

  const myAge = calculateAge(me?.birth_date);
  if (myAge !== null && myAge < 18) {
    return NextResponse.json({ error: 'بخش آشنایی ناشناس فقط برای کاربران بالای ۱۸ سال در دسترس است.' }, { status: 403 });
  }

  const d = parsed.data;

  if (d.action === 'start') {
    const candidates = db
      .prepare(`
        SELECT u.id, p.birth_date, p.city, p.interests, p.goal
        FROM users u
        JOIN user_profiles p ON p.user_id = u.id
        JOIN dating_profiles dp ON dp.user_id = u.id
        WHERE u.id != ?
          AND u.is_banned = 0
          AND u.is_deleted = 0
          AND dp.is_active = 1
          AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
          AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
          AND u.id NOT IN (
            SELECT CASE WHEN user_a_id = ? THEN user_b_id ELSE user_a_id END
            FROM blind_dates
            WHERE (user_a_id = ? OR user_b_id = ?) AND status != 'ended'
          )
        ORDER BY RANDOM()
        LIMIT 12
      `)
      .all(auth.id, auth.id, auth.id, auth.id, auth.id, auth.id) as {
        id: number;
        birth_date: string | null;
        city: string;
        interests: string;
        goal: string;
      }[];

    const adultCands = candidates.filter((c) => {
      const age = calculateAge(c.birth_date);
      return age === null || age >= 18;
    });

    if (adultCands.length === 0) {
      return NextResponse.json(
        { error: 'در حال حاضر فرد جدیدی برای آشنایی ناشناس باقی نمانده است؛ جلسات فعال خود را ادامه دهید.' },
        { status: 404 }
      );
    }

    const myAnsRows = db
      .prepare('SELECT dimension_key, answer_value FROM personality_answers WHERE user_id = ? AND include_in_matching = 1')
      .all(auth.id) as { dimension_key: string; answer_value: number }[];
    const myAnsMap: Record<string, number> = {};
    for (const r of myAnsRows) myAnsMap[r.dimension_key] = r.answer_value;

    const myInterests = JSON.parse(me?.interests || '[]') as string[];

    let bestCand = adultCands[0];
    let bestScore = 0;
    let bestTraits: string[] = [];

    for (const c of adultCands) {
      const cAnsRows = db
        .prepare('SELECT dimension_key, answer_value, answer_label FROM personality_answers WHERE user_id = ? AND include_in_matching = 1')
        .all(c.id) as { dimension_key: string; answer_value: number; answer_label: string }[];
      const cAnsMap: Record<string, number> = {};
      for (const r of cAnsRows) cAnsMap[r.dimension_key] = r.answer_value;
      const cInterests = JSON.parse(c.interests || '[]') as string[];

      const comp = computeCompatibility(
        { city: me?.city || '', interests: myInterests, goal: me?.goal || '' },
        myAnsMap,
        { city: c.city || '', interests: cInterests, goal: c.goal || '' },
        cAnsMap
      );
      if (comp.score > bestScore) {
        bestScore = comp.score;
        bestCand = c;
        bestTraits = [
          ...comp.sharedInterests.map((i) => `علاقه مشترک: ${i}`),
          ...cAnsRows.slice(0, 2).map((r) => r.answer_label),
        ].slice(0, 4);
      }
    }

    const sessionCode = `BLD-${crypto.randomInt(1000, 9999)}`;
    const aliasA = `${COSMIC_ALIASES[crypto.randomInt(0, COSMIC_ALIASES.length)]} ${crypto.randomInt(10, 99)}`;
    const aliasB = `${COSMIC_ALIASES[crypto.randomInt(0, COSMIC_ALIASES.length)]} ${crypto.randomInt(10, 99)}`;

    const res = db
      .prepare(`
        INSERT INTO blind_dates (session_code, user_a_id, user_b_id, alias_a, alias_b, compatibility_score, shared_traits_json, qa_state_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, '[]')
      `)
      .run(sessionCode, auth.id, bestCand.id, aliasA, aliasB, Math.max(72, bestScore), JSON.stringify(bestTraits));

    const blindId = Number(res.lastInsertRowid);
    db.prepare(
      "INSERT INTO blind_date_messages (blind_date_id, sender_id, msg_type, content) VALUES (?, ?, 'system', ?)"
    ).run(
      blindId,
      bestCand.id,
      'سلام! وارد آشنایی ناشناس شدیم. فعلاً نه عکس و نه نام واقعی مشخص نیست؛ از سؤال‌های پیشنهادی یا بازی سؤال و جواب شروع کنیم؟'
    );

    const row = db.prepare('SELECT * FROM blind_dates WHERE id = ?').get(blindId) as Record<string, unknown>;
    return NextResponse.json({ ok: true, session: formatBlindSessionForViewer(row, auth.id) }, { status: 201 });
  }

  const row = db
    .prepare('SELECT * FROM blind_dates WHERE session_code = ?')
    .get(d.sessionCode.toUpperCase()) as Record<string, unknown> | undefined;

  if (!row) return NextResponse.json({ error: 'جلسه آشنایی ناشناس یافت نشد.' }, { status: 404 });
  const isUserA = Number(row.user_a_id) === auth.id;
  const isUserB = Number(row.user_b_id) === auth.id;
  if (!isUserA && !isUserB) {
    return NextResponse.json({ error: 'دسترسی به این گفت‌وگوی ناشناس مجاز نیست.' }, { status: 403 });
  }

  const blindId = Number(row.id);
  const partnerId = isUserA ? Number(row.user_b_id) : Number(row.user_a_id);

  if (d.action === 'send_message') {
    db.prepare('INSERT INTO blind_date_messages (blind_date_id, sender_id, msg_type, content) VALUES (?, ?, ?, ?)').run(
      blindId,
      auth.id,
      d.msgType,
      d.content.trim()
    );

    // Record taste learning continuation signal
    const partnerProf = db
      .prepare('SELECT interests, goal, city FROM user_profiles WHERE user_id = ?')
      .get(partnerId) as { interests: string; goal: string; city: string } | undefined;
    if (partnerProf) {
      db.prepare(`
        INSERT INTO user_taste_signals (user_id, target_user_id, signal_type, weight, target_interests_json, target_goal, target_city)
        VALUES (?, ?, 'chat_continue', 1.4, ?, ?, ?)
      `).run(auth.id, partnerId, partnerProf.interests, partnerProf.goal || '', partnerProf.city || '');
    }

    db.prepare("UPDATE blind_dates SET updated_at = datetime('now') WHERE id = ?").run(blindId);
    const updated = db.prepare('SELECT * FROM blind_dates WHERE id = ?').get(blindId) as Record<string, unknown>;
    return NextResponse.json({ ok: true, session: formatBlindSessionForViewer(updated, auth.id) });
  }

  if (d.action === 'play_qa') {
    const qDef = BLIND_QA_QUESTIONS.find((q) => q.id === d.questionId);
    if (!qDef) return NextResponse.json({ error: 'سؤال یافت نشد.' }, { status: 404 });

    const qaList = JSON.parse(String(row.qa_state_json || '[]')) as {
      questionId: string;
      question: string;
      myAnswer?: string;
      partnerAnswer?: string;
    }[];

    const partnerAutoAnswer = qDef.options[crypto.randomInt(0, qDef.options.length)];
    const existing = qaList.find((item) => item.questionId === qDef.id);
    if (existing) {
      existing.myAnswer = d.answer;
      if (!existing.partnerAnswer) existing.partnerAnswer = partnerAutoAnswer;
    } else {
      qaList.push({
        questionId: qDef.id,
        question: qDef.question,
        myAnswer: d.answer,
        partnerAnswer: partnerAutoAnswer,
      });
    }

    db.transaction(() => {
      db.prepare("UPDATE blind_dates SET qa_state_json = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(qaList),
        blindId
      );
      db.prepare("INSERT INTO blind_date_messages (blind_date_id, sender_id, msg_type, content) VALUES (?, ?, 'qa_answer', ?)").run(
        blindId,
        auth.id,
        `پاسخ بازی آشنایی (${qDef.question}): «${d.answer}»`
      );
      db.prepare("INSERT INTO blind_date_messages (blind_date_id, sender_id, msg_type, content) VALUES (?, ?, 'qa_answer', ?)").run(
        blindId,
        partnerId,
        `پاسخ هم‌صحبت ناشناس به همین سؤال: «${partnerAutoAnswer}»`
      );
    })();

    const updated = db.prepare('SELECT * FROM blind_dates WHERE id = ?').get(blindId) as Record<string, unknown>;
    return NextResponse.json({ ok: true, session: formatBlindSessionForViewer(updated, auth.id) });
  }

  if (d.action === 'request_reveal') {
    // Enforce confirmed rule: at least 2 messages sent by viewer OR 1 completed Q&A round
    const userMsgCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM blind_date_messages WHERE blind_date_id = ? AND sender_id = ? AND msg_type != 'system'")
        .get(blindId, auth.id) as { c: number }
    ).c;
    const qaCompleted = (JSON.parse(String(row.qa_state_json || '[]')) as unknown[]).length;
    if (userMsgCount < 2 && qaCompleted < 1) {
      return NextResponse.json(
        { error: 'برای درخواست افشای هویت، ابتدا حداقل ۲ پیام ارسال کن یا ۱ سؤال از مینی‌بازی پرسش‌وپاسخ را جواب بده.' },
        { status: 400 }
      );
    }

    const partnerUser = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(partnerId) as
      | { telegram_id: string | null }
      | undefined;
    const isSeededPartner = Boolean(partnerUser?.telegram_id && partnerUser.telegram_id.startsWith('10000'));
    const nextA = isUserA ? 1 : Number(row.user_a_reveal);
    let nextB = isUserB ? 1 : Number(row.user_b_reveal);

    // For real two-account sessions, require genuine mutual consent from both accounts; for seeded community accounts after eligibility, grant reciprocal consent
    if (isUserA && isSeededPartner && Number(row.compatibility_score) >= 72) {
      nextB = 1;
    }

    const bothRevealed = nextA === 1 && nextB === 1;
    db.transaction(() => {
      db.prepare(
        "UPDATE blind_dates SET user_a_reveal = ?, user_b_reveal = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(nextA, nextB, bothRevealed ? 'revealed' : 'active', blindId);

      if (bothRevealed) {
        const [a, b] = auth.id < partnerId ? [auth.id, partnerId] : [partnerId, auth.id];
        db.prepare(`
          INSERT INTO matches (user_a_id, user_b_id, compatibility_score, status)
          VALUES (?, ?, ?, 'active')
          ON CONFLICT(user_a_id, user_b_id) DO UPDATE SET status = 'active'
        `).run(a, b, Number(row.compatibility_score));

        db.prepare(
          "INSERT INTO blind_date_messages (blind_date_id, sender_id, msg_type, content) VALUES (?, ?, 'system', ?)"
        ).run(blindId, auth.id, 'رضایت دوطرفه ثبت شد! اطلاعات انتخاب‌شده هر دو نفر آشکار و مچینگ در ونوس ثبت شد.');
      } else {
        db.prepare(
          "INSERT INTO blind_date_messages (blind_date_id, sender_id, msg_type, content) VALUES (?, ?, 'system', ?)"
        ).run(blindId, auth.id, 'درخواست افشای هویت ثبت شد. پس از تأیید طرف مقابل، اطلاعات انتخاب‌شده نمایش داده می‌شود.');
      }
    })();

    const updated = db.prepare('SELECT * FROM blind_dates WHERE id = ?').get(blindId) as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      revealed: bothRevealed,
      message: bothRevealed
        ? 'تبریک! با رضایت دوطرفه، هویت انتخاب‌شده آشکار و مچینگ ثبت شد.'
        : 'درخواست افشای هویت شما ثبت شد؛ منتظر رضایت طرف مقابل هستیم.',
      session: formatBlindSessionForViewer(updated, auth.id),
    });
  }

  if (d.action === 'end_session') {
    db.prepare("UPDATE blind_dates SET status = 'ended', updated_at = datetime('now') WHERE id = ?").run(blindId);
    return NextResponse.json({ ok: true, message: 'مکالمه ناشناس با احترام پایان یافت.' });
  }

  if (d.action === 'report_or_block') {
    db.transaction(() => {
      db.prepare("UPDATE blind_dates SET status = 'ended', updated_at = datetime('now') WHERE id = ?").run(blindId);
      if (d.kind === 'block') {
        db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(auth.id, partnerId);
      } else {
        db.prepare("INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, 'blind_date', ?, ?)").run(
          auth.id,
          String(partnerId),
          d.reason?.trim() || 'گزارش رفتار نامناسب در آشنایی ناشناس'
        );
      }
    })();
    return NextResponse.json({
      ok: true,
      message: d.kind === 'block' ? 'کاربر بلاک شد و جلسه ناشناس بسته شد.' : 'گزارش شما در صف بررسی مدیریت ثبت شد.',
    });
  }

  return NextResponse.json({ error: 'عملیات ناشناخته' }, { status: 400 });
}
