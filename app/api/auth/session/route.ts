import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb, adjustStarsAtomic } from '@/lib/db';
import {
  calculateAge,
  checkRateLimit,
  createSession,
  getAuthUser,
  getClientIp,
  hashPassword,
  verifyPassword,
  verifyTelegramInitData,
} from '@/lib/security';

const AuthActionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('login'),
    username: z.string().min(3).max(40),
    password: z.string().min(6).max(128),
  }),
  z.object({
    mode: z.literal('register'),
    username: z.string().regex(/^[a-zA-Z0-9_]{3,28}$/, 'نام کاربری باید انگلیسی و بین ۳ تا ۲۸ کاراکتر باشد'),
    displayName: z.string().min(2).max(40),
    password: z.string().min(6).max(128),
    birthDate: z.string().optional(),
    city: z.string().max(40).optional(),
    referralCode: z.string().max(32).optional(),
  }),
  z.object({
    mode: z.literal('telegram'),
    initData: z.string().min(1),
    referralCode: z.string().max(32).optional(),
  }),
  z.object({
    mode: z.literal('demo_enter'),
  }),
]);

function buildUserBundle(userId: number) {
  const db = getDb();
  const user = db
    .prepare(`
      SELECT u.id, u.telegram_id, u.username, u.display_name, u.phone, u.phone_verified,
             u.role, u.subscription_tier, u.level, u.xp, u.referral_code, u.anon_slug,
             u.allow_whispers, u.created_at,
             p.avatar_color, p.avatar_initials, p.gender, p.birth_date, p.city, p.province,
             p.cultural_bg, p.bio, p.interests, p.hobbies, p.relationship_status, p.goal,
             p.preferred_connection, p.favorite_planet, p.equipped_frame, p.equipped_badge,
             p.hide_city, p.hide_online, p.dating_enabled, p.dating_min_age, p.dating_max_age,
             p.dating_gender_pref, p.use_personality_in_matching,
             w.free_stars, w.paid_stars
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      JOIN star_wallets w ON w.user_id = u.id
      WHERE u.id = ? AND u.is_deleted = 0
    `)
    .get(userId) as Record<string, unknown> | undefined;

  if (!user) return null;

  const age = calculateAge(user.birth_date as string | null);
  const sessions = db
    .prepare(
      'SELECT id, device_label, ip_address, created_at FROM user_sessions WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 10'
    )
    .all(userId);
  const notifications = db
    .prepare('SELECT id, type, title, body, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 15')
    .all(userId);
  const inventory = db
    .prepare('SELECT item_id, purchased_at FROM user_inventory WHERE user_id = ?')
    .all(userId) as { item_id: string; purchased_at: string }[];
  const constellationFriends = db
    .prepare(`
      SELECT u.id, u.username, u.display_name, u.level, p.avatar_initials, p.avatar_color, r.created_at
      FROM referral_events r
      JOIN users u ON u.id = r.referred_user_id
      JOIN user_profiles p ON p.user_id = u.id
      WHERE r.referrer_user_id = ? AND r.status = 'verified' AND u.is_deleted = 0
      ORDER BY r.id DESC
      LIMIT 12
    `)
    .all(userId) as {
      id: number;
      username: string;
      display_name: string;
      level: number;
      avatar_initials: string;
      avatar_color: string;
      created_at: string;
    }[];
  const referralCount = constellationFriends.length;

  const gamesPlayedCount = (
    db.prepare('SELECT COUNT(*) as c FROM game_history WHERE user_id = ?').get(userId) as { c: number }
  ).c;

  // Separated Dating Profile (optional — users can join purely for games & social)
  const datingProfileRow = db
    .prepare(
      'SELECT is_active, dating_bio, looking_for, min_age, max_age, gender_pref, show_city, activated_at FROM dating_profiles WHERE user_id = ?'
    )
    .get(userId) as
    | {
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

  // Multi-layer 18+ Verification (birthdate alone NEVER unlocks 18+)
  const adultRow = db
    .prepare('SELECT status, phone_confirmed, consent_accepted, reviewed_by, reviewed_at FROM adult_verifications WHERE user_id = ?')
    .get(userId) as
    | {
        status: 'unverified' | 'pending_review' | 'verified' | 'rejected';
        phone_confirmed: number;
        consent_accepted: number;
        reviewed_by: string | null;
        reviewed_at: string | null;
      }
    | undefined;

  const phoneVerified = Boolean(user.phone_verified);
  const birthDateOver18 = age !== null && age >= 18;
  const adultStatus = adultRow?.status ?? 'unverified';
  const adultConsentAccepted = Boolean(adultRow?.consent_accepted);
  const isAdultVerified =
    adultStatus === 'verified' && phoneVerified && birthDateOver18 && adultConsentAccepted;

  // Personal Galaxy Earth Planet Evolution tied to XP, Stars, Referrals & Activity
  const totalStars = Number(user.free_stars || 0) + Number(user.paid_stars || 0);
  const xp = Number(user.xp || 0);
  const evolutionScore = xp + referralCount * 120 + gamesPlayedCount * 35 + Math.min(300, totalStars);
  const evolutionStages = [
    {
      stage: 1,
      title: 'زمینِ نوبنیاد',
      subtitle: 'هسته آرام کهکشان شخصی تو',
      minScore: 0,
      ringAccent: '#38bdf8',
      auraStyle: 'atmosphere',
    },
    {
      stage: 2,
      title: 'زمینِ درخشان',
      subtitle: 'شفق آبی و اولین حلقه مداری فعال',
      minScore: 300,
      ringAccent: '#22d3ee',
      auraStyle: 'aurora',
    },
    {
      stage: 3,
      title: 'زمینِ اسطرلابی',
      subtitle: 'حلقه طلایی دوگانه و منظومه اجتماعی پویا',
      minScore: 700,
      ringAccent: '#eab308',
      auraStyle: 'astrolabe',
    },
    {
      stage: 4,
      title: 'کهکشانِ فرمانروا',
      subtitle: 'تاج کیهانی کامل با ستارگان و همراهان مداری',
      minScore: 1300,
      ringAccent: '#f59e0b',
      auraStyle: 'sovereign',
    },
  ];
  let currentStage = evolutionStages[0];
  let nextStage: (typeof evolutionStages)[number] | null = evolutionStages[1];
  for (let i = 0; i < evolutionStages.length; i++) {
    if (evolutionScore >= evolutionStages[i].minScore) {
      currentStage = evolutionStages[i];
      nextStage = evolutionStages[i + 1] ?? null;
    }
  }
  const progressPercent = nextStage
    ? Math.min(
        100,
        Math.max(
          5,
          Math.round(((evolutionScore - currentStage.minScore) / (nextStage.minScore - currentStage.minScore)) * 100)
        )
      )
    : 100;

  // Earned Loyalty Badges
  const earnedBadges: { id: string; title: string; tone: string }[] = [
    { id: 'pioneer', title: 'کاوشگر مدار', tone: 'sky' },
  ];
  if (totalStars >= 150) earnedBadges.push({ id: 'star_keeper', title: 'ستاره‌چین', tone: 'amber' });
  if (referralCount >= 1) earnedBadges.push({ id: 'constellation', title: 'گسترش‌دهنده منظومه', tone: 'emerald' });
  if (gamesPlayedCount >= 1 || Number(user.level) >= 3) earnedBadges.push({ id: 'strategist', title: 'استراتژیست بازی‌ها', tone: 'violet' });
  if (phoneVerified) earnedBadges.push({ id: 'verified_phone', title: 'حساب تأییدشده', tone: 'emerald' });
  if (isAdultVerified) earnedBadges.push({ id: 'adult_verified', title: 'احراز ۱۸+', tone: 'rose' });

  const planetsRow = db.prepare("SELECT value_json FROM system_settings WHERE key = 'planets'").get() as
    | { value_json: string }
    | undefined;

  return {
    user: {
      ...user,
      // Mask phone partially for UI hygiene while still showing user their verified status
      phoneMasked: user.phone ? `${String(user.phone).slice(0, 6)}****${String(user.phone).slice(-2)}` : null,
      phone: undefined,
      age,
      isAdult: birthDateOver18,
      isAdultVerified,
      adultVerification: {
        status: adultStatus,
        phoneVerified,
        birthDateOver18,
        consentAccepted: adultConsentAccepted,
        isAdultContentAllowed: isAdultVerified,
        reviewedBy: adultRow?.reviewed_by ?? null,
        reviewedAt: adultRow?.reviewed_at ?? null,
      },
      datingProfile: datingProfileRow
        ? {
            exists: true,
            isActive: Boolean(datingProfileRow.is_active),
            datingBio: datingProfileRow.dating_bio,
            lookingFor: datingProfileRow.looking_for,
            minAge: datingProfileRow.min_age,
            maxAge: datingProfileRow.max_age,
            genderPref: datingProfileRow.gender_pref,
            showCity: Boolean(datingProfileRow.show_city),
            activatedAt: datingProfileRow.activated_at,
          }
        : {
            exists: false,
            isActive: false,
            datingBio: '',
            lookingFor: 'آشنایی جدی و گفت‌وگوی عمیق',
            minAge: 18,
            maxAge: 45,
            genderPref: 'all',
            showCity: true,
            activatedAt: null,
          },
      constellationFriends,
      earnedBadges,
      planetEvolution: {
        stage: currentStage.stage,
        title: currentStage.title,
        subtitle: currentStage.subtitle,
        ringAccent: currentStage.ringAccent,
        auraStyle: currentStage.auraStyle,
        evolutionScore,
        nextStageTitle: nextStage?.title ?? null,
        pointsToNext: nextStage ? Math.max(0, nextStage.minScore - evolutionScore) : 0,
        progressPercent,
      },
      interests: JSON.parse(String(user.interests || '[]')),
      hobbies: JSON.parse(String(user.hobbies || '[]')),
      totalStars,
      referralCount,
      gamesPlayedCount,
    },
    sessions,
    notifications,
    inventory: inventory.map((i) => i.item_id),
    planets: planetsRow ? JSON.parse(planetsRow.value_json) : [],
  };
}

export async function GET(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) {
    const db = getDb();
    const planetsRow = db.prepare("SELECT value_json FROM system_settings WHERE key = 'planets'").get() as
      | { value_json: string }
      | undefined;
    return NextResponse.json({
      authenticated: false,
      planets: planetsRow ? JSON.parse(planetsRow.value_json) : [],
      botUsername: process.env.TELEGRAM_BOT_USERNAME || 'MadarBot',
    });
  }

  const bundle = buildUserBundle(auth.id);
  if (!bundle) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    currentSessionId: auth.session_id,
    botUsername: process.env.TELEGRAM_BOT_USERNAME || 'MadarBot',
    ...bundle,
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`auth:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً ${rl.retryAfterSec} ثانیه صبر کنید.` },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const parsed = AuthActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'اطلاعات ارسالی نامعتبر است.' }, { status: 400 });
    }

    const db = getDb();
    const data = parsed.data;

    if (data.mode === 'demo_enter') {
      const demo = db.prepare("SELECT id FROM users WHERE username = 'parham_sky' AND is_deleted = 0").get() as
        | { id: number }
        | undefined;
      if (!demo) {
        return NextResponse.json({ error: 'حساب پایه در دسترس نیست. لطفاً ثبت‌نام کنید.' }, { status: 404 });
      }
      const sess = createSession(demo.id, 'پیش‌نمایش وب مدار', ip);
      return NextResponse.json({ token: sess.token, currentSessionId: sess.sessionId, ...buildUserBundle(demo.id) });
    }

    if (data.mode === 'login') {
      const uname = data.username.trim().toLowerCase().replace(/^@/, '');
      const userRow = db
        .prepare('SELECT id, password_hash, is_banned FROM users WHERE lower(username) = ? AND is_deleted = 0')
        .get(uname) as { id: number; password_hash: string | null; is_banned: number } | undefined;

      if (!userRow || !verifyPassword(data.password, userRow.password_hash)) {
        return NextResponse.json({ error: 'نام کاربری یا رمز عبور مدار نادرست است.' }, { status: 401 });
      }
      if (userRow.is_banned) {
        return NextResponse.json({ error: 'این حساب توسط مدیریت مدار مسدود شده است.' }, { status: 403 });
      }

      const sess = createSession(userRow.id, 'ورود با رمز مدار', ip);
      return NextResponse.json({ token: sess.token, currentSessionId: sess.sessionId, ...buildUserBundle(userRow.id) });
    }

    if (data.mode === 'register') {
      const uname = data.username.trim().toLowerCase();
      const exists = db.prepare('SELECT id FROM users WHERE lower(username) = ?').get(uname);
      if (exists) {
        return NextResponse.json({ error: 'این نام کاربری قبلاً در مدار ثبت شده است.' }, { status: 409 });
      }

      const refCode = `ref_${uname.slice(0, 8)}${crypto.randomInt(10, 99)}`;
      const initials = data.displayName.trim().slice(0, 2);
      const pwHash = hashPassword(data.password);

      let referrerId: number | null = null;
      if (data.referralCode) {
        const refRow = db
          .prepare('SELECT id FROM users WHERE referral_code = ? AND is_deleted = 0')
          .get(data.referralCode.trim()) as { id: number } | undefined;
        if (refRow) referrerId = refRow.id;
      }

      const createTx = db.transaction(() => {
        const res = db
          .prepare(`
            INSERT INTO users (username, display_name, password_hash, referral_code, referred_by_user_id, anon_slug)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(uname, data.displayName.trim(), pwHash, refCode, referrerId, uname);

        const uid = Number(res.lastInsertRowid);
        db.prepare(`
          INSERT INTO user_profiles (user_id, avatar_initials, birth_date, city, province, interests, dating_enabled)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(uid, initials, data.birthDate || '1999-01-01', data.city || 'تهران', data.city || 'تهران', JSON.stringify(['بازی گروهی', 'گفت‌وگو']));

        db.prepare('INSERT INTO star_wallets (user_id, free_stars, paid_stars) VALUES (?, 100, 0)').run(uid);
        db.prepare(
          "INSERT INTO star_transactions (user_id, amount, star_bucket, tx_type, description) VALUES (?, 100, 'free', 'welcome_bonus', 'پاداش عضویت در مدار')"
        ).run(uid);

        db.prepare(
          "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'welcome', 'به مدار خوش آمدی!', '۱۰۰ ستاره خوش‌آمدگویی به کیف‌پول تو واریز شد.')"
        ).run(uid);

        if (referrerId && referrerId !== uid) {
          const econRow = db.prepare("SELECT value_json FROM system_settings WHERE key = 'economy'").get() as
            | { value_json: string }
            | undefined;
          const rewardStars = econRow ? Number(JSON.parse(econRow.value_json).referralRewardStars || 50) : 50;
          db.prepare(
            "INSERT INTO referral_events (referrer_user_id, referred_user_id, status, reward_stars) VALUES (?, ?, 'verified', ?)"
          ).run(referrerId, uid, rewardStars);
          adjustStarsAtomic(referrerId, rewardStars, 'free', 'referral_reward', `پاداش دعوت موفق @${uname}`, String(uid));
          db.prepare(
            "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'referral', 'دعوت موفق ثبت شد', ?)"
          ).run(referrerId, `دوست تو @${uname} ثبت‌نام کرد و ${rewardStars} ستاره به کیف‌پولت اضافه شد.`);
        }

        return uid;
      });

      const newUserId = createTx();
      const sess = createSession(newUserId, 'ثبت‌نام جدید مدار', ip);
      return NextResponse.json(
        { token: sess.token, currentSessionId: sess.sessionId, ...buildUserBundle(newUserId) },
        { status: 201 }
      );
    }

    if (data.mode === 'telegram') {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return NextResponse.json(
          {
            error:
              'متغیر TELEGRAM_BOT_TOKEN روی سرور تنظیم نشده است. برای احراز هویت واقعی تلگرام، توکن ربات را در متغیرهای محیطی سرور قرار دهید یا از ورود مستقل مدار استفاده کنید.',
          },
          { status: 503 }
        );
      }

      const verified = verifyTelegramInitData(data.initData, botToken);
      if (!verified.valid || !verified.user) {
        return NextResponse.json({ error: verified.error || 'امضای امنیتی Telegram initData نامعتبر است.' }, { status: 401 });
      }

      const tgId = String(verified.user.id);
      let existing = db.prepare('SELECT id, is_banned FROM users WHERE telegram_id = ? AND is_deleted = 0').get(tgId) as
        | { id: number; is_banned: number }
        | undefined;

      if (existing?.is_banned) {
        return NextResponse.json({ error: 'این حساب تلگرام در مدار مسدود شده است.' }, { status: 403 });
      }

      let uid: number;
      if (existing) {
        uid = existing.id;
      } else {
        const baseName = (verified.user.username || `tg_${tgId}`).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 22);
        const uniqueUname = `${baseName}_${crypto.randomInt(10, 99)}`;
        const display = [verified.user.first_name, verified.user.last_name].filter(Boolean).join(' ') || 'کاربر مدار';
        const refCode = `ref_${tgId.slice(-6)}${crypto.randomInt(10, 99)}`;

        const createTgTx = db.transaction(() => {
          const res = db
            .prepare(`
              INSERT INTO users (telegram_id, username, display_name, referral_code, anon_slug)
              VALUES (?, ?, ?, ?, ?)
            `)
            .run(tgId, uniqueUname, display, refCode, uniqueUname);
          const id = Number(res.lastInsertRowid);
          db.prepare('INSERT INTO user_profiles (user_id, avatar_initials) VALUES (?, ?)').run(id, display.slice(0, 2));
          db.prepare('INSERT INTO star_wallets (user_id, free_stars, paid_stars) VALUES (?, 100, 0)').run(id);
          return id;
        });
        uid = createTgTx();
      }

      const sess = createSession(uid, 'Telegram Mini App', ip);
      return NextResponse.json({ token: sess.token, currentSessionId: sess.sessionId, ...buildUserBundle(uid) });
    }

    return NextResponse.json({ error: 'حالت ورود نامعتبر است.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'خطای داخلی در پردازش احراز هویت.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'ابتدا وارد حساب کاربری شوید.' }, { status: 401 });

  const db = getDb();
  const scope = req.nextUrl.searchParams.get('scope') || 'current';

  if (scope === 'others') {
    db.prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ? AND id != ?').run(auth.id, auth.session_id);
    return NextResponse.json({ ok: true, message: 'تمام نشست‌های دیگر با موفقیت بسته شدند.' });
  }

  if (scope === 'delete_account') {
    db.transaction(() => {
      db.prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?').run(auth.id);
      db.prepare(
        "UPDATE users SET is_deleted = 1, phone = NULL, password_hash = NULL, display_name = 'کاربر حذف‌شده' WHERE id = ?"
      ).run(auth.id);
    })();
    return NextResponse.json({ ok: true, message: 'حساب کاربری و اطلاعات خصوصی شما حذف شد.' });
  }

  db.prepare('UPDATE user_sessions SET revoked = 1 WHERE id = ?').run(auth.session_id);
  return NextResponse.json({ ok: true, message: 'از حساب کاربری خارج شدید.' });
}
