import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import {
  calculateAge,
  checkRateLimit,
  createSession,
  getAuthUser,
  getClientIp,
  isSessionSecretConfigured,
  logSystemError,
  resolveAdminAuthority,
  verifyTelegramInitData,
} from '@/lib/security';
import {
  fetchTelegramAvatarProxyUrl,
  getBotUsername,
  getForcedChannels,
  upsertTelegramUser,
  verifyForcedChannelMembership,
} from '@/lib/telegram-bot';

// Telegram Mini App initData is the ONLY authentication method for MADAR.
// All password login, manual registration, email, and SMS OTP flows are removed.
const TelegramAuthSchema = z.object({
  mode: z.literal('telegram'),
  initData: z.string().min(10, 'اطلاعات ورود تلگرام نامعتبر است.').max(8192),
  referralCode: z.string().max(32).optional(),
});

function getBotSettings(): { welcomeText: string; requirePhoneContact: boolean; maintenanceMode: boolean } {
  const db = getDb();
  const row = db.prepare("SELECT value_json FROM system_settings WHERE key = 'bot_settings'").get() as
    | { value_json: string }
    | undefined;
  if (!row) return { welcomeText: 'به مدار خوش آمدی.', requirePhoneContact: true, maintenanceMode: false };
  try {
    const parsed = JSON.parse(row.value_json);
    return {
      welcomeText: String(parsed.welcomeText || 'به مدار خوش آمدی.'),
      requirePhoneContact: parsed.requirePhoneContact !== false,
      maintenanceMode: Boolean(parsed.maintenanceMode),
    };
  } catch {
    return { welcomeText: 'به مدار خوش آمدی.', requirePhoneContact: true, maintenanceMode: false };
  }
}

function buildUserBundle(userId: number) {
  const db = getDb();
  const user = db
    .prepare(`
      SELECT u.id, u.telegram_id, u.username, u.display_name, u.phone_verified,
             u.telegram_first_name, u.telegram_last_name, u.telegram_username,
             u.telegram_photo_url, u.telegram_language_code, u.last_login_at,
             u.onboarding_completed, u.channel_verified_at, u.phone_shared_at,
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

  const totalStars = Number(user.free_stars || 0) + Number(user.paid_stars || 0);
  const xp = Number(user.xp || 0);
  const evolutionScore = xp + referralCount * 120 + gamesPlayedCount * 35 + Math.min(300, totalStars);
  const evolutionStages = [
    { stage: 1, title: 'زمینِ نوبنیاد', subtitle: 'هسته آرام کهکشان شخصی تو', minScore: 0, ringAccent: '#38bdf8', auraStyle: 'atmosphere' },
    { stage: 2, title: 'زمینِ درخشان', subtitle: 'شفق آبی و اولین حلقه مداری فعال', minScore: 300, ringAccent: '#22d3ee', auraStyle: 'aurora' },
    { stage: 3, title: 'زمینِ اسطرلابی', subtitle: 'حلقه طلایی دوگانه و منظومه اجتماعی پویا', minScore: 700, ringAccent: '#eab308', auraStyle: 'astrolabe' },
    { stage: 4, title: 'کهکشانِ فرمانروا', subtitle: 'تاج کیهانی کامل با ستارگان و همراهان مداری', minScore: 1300, ringAccent: '#f59e0b', auraStyle: 'sovereign' },
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
    ? Math.min(100, Math.max(5, Math.round(((evolutionScore - currentStage.minScore) / (nextStage.minScore - currentStage.minScore)) * 100)))
    : 100;

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
      // Phone number is NEVER exposed to clients or other users; only verification status is returned.
      phoneMasked: null,
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
  const botUsername = getBotUsername();
  const previewAvailable = process.env.NODE_ENV !== 'production';
  const auth = getAuthUser(req);

  if (!auth) {
    const db = getDb();
    const planetsRow = db.prepare("SELECT value_json FROM system_settings WHERE key = 'planets'").get() as
      | { value_json: string }
      | undefined;
    return NextResponse.json({
      authenticated: false,
      isAdmin: false,
      isPrimaryAdmin: false,
      previewAvailable,
      planets: planetsRow ? JSON.parse(planetsRow.value_json) : [],
      botUsername,
    });
  }

  const bundle = buildUserBundle(auth.id);
  if (!bundle) {
    return NextResponse.json({ authenticated: false, botUsername, previewAvailable }, { status: 401 });
  }

  const adminAuth = resolveAdminAuthority(auth);
  const botSettings = getBotSettings();
  const activeChannels = getForcedChannels().filter((c) => c.enabled);

  let channelsVerified = activeChannels.length === 0;
  let channels: { id: string; chatId: string; title: string; inviteUrl: string; joined: boolean }[] =
    activeChannels.map((c) => ({
      id: c.id,
      chatId: c.chatId,
      title: c.title,
      inviteUrl: c.inviteUrl,
      joined: false,
    }));
  if (activeChannels.length > 0 && auth.telegram_id && !adminAuth.isAdmin) {
    const check = await verifyForcedChannelMembership(auth.telegram_id);
    channelsVerified = check.allJoined;
    channels = check.channels;
  } else if (adminAuth.isAdmin) {
    channelsVerified = true;
  }

  const phoneShared = Boolean(auth.phone_verified);
  const needsContactShare = !adminAuth.isAdmin && botSettings.requirePhoneContact && !phoneShared;

  return NextResponse.json({
    authenticated: true,
    currentSessionId: auth.session_id,
    botUsername,
    previewAvailable,
    isAdmin: adminAuth.isAdmin,
    isPrimaryAdmin: adminAuth.isPrimaryAdmin,
    adminRole: adminAuth.role,
    onboarding: {
      channelsVerified,
      channels,
      phoneShared,
      needsContactShare,
      onboardingCompleted: channelsVerified && !needsContactShare,
    },
    ...bundle,
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`auth:${ip}`, 30, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `تعداد تلاش‌های ورود بیش از حد مجاز است. ${rl.retryAfterSec} ثانیه صبر کنید.` },
      { status: 429 }
    );
  }

  if (process.env.NODE_ENV === 'production' && !isSessionSecretConfigured()) {
    logSystemError('auth_session', 'SESSION_SECRET is not configured in production');
    return NextResponse.json({ error: 'تنظیمات امنیتی نشست سرور کامل نیست.' }, { status: 503 });
  }

  try {
    const body = await req.json().catch(() => null);
    const parsed = TelegramAuthSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'ورود به مدار فقط از طریق حساب تلگرام (Telegram Mini App) امکان‌پذیر است.' },
        { status: 400 }
      );
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!botToken) {
      return NextResponse.json(
        { error: 'اتصال ربات تلگرام روی سرور پیکربندی نشده است.' },
        { status: 503 }
      );
    }

    const verified = verifyTelegramInitData(parsed.data.initData, botToken);
    if (!verified.valid || !verified.user) {
      return NextResponse.json(
        { error: verified.error || 'امضای امنیتی Telegram initData معتبر نیست.' },
        { status: 401 }
      );
    }

    // If initData does not carry photo_url, optionally resolve via Bot API avatar proxy
    let fallbackPhoto: string | null = null;
    if (!verified.user.photo_url) {
      fallbackPhoto = await fetchTelegramAvatarProxyUrl(verified.user.id);
    }

    const refFromStart =
      parsed.data.referralCode ||
      (verified.startParam?.startsWith('ref_') ? verified.startParam : undefined);

    const upserted = upsertTelegramUser(verified.user, {
      referralCode: refFromStart,
      updateLoginTime: true,
      resolvedPhotoUrl: fallbackPhoto,
    });

    if (upserted.isBanned) {
      return NextResponse.json({ error: 'این حساب تلگرام در مدار مسدود شده است.' }, { status: 403 });
    }

    const sess = createSession(upserted.userId, 'Telegram Mini App', ip);
    const bundle = buildUserBundle(upserted.userId);
    const db = getDb();
    const userRow = db
      .prepare('SELECT id, telegram_id, username, display_name, role, subscription_tier, phone_verified, onboarding_completed, is_banned FROM users WHERE id = ?')
      .get(upserted.userId) as {
      id: number;
      telegram_id: string | null;
      username: string;
      display_name: string;
      role: string;
      subscription_tier: string;
      phone_verified: number;
      onboarding_completed: number;
      is_banned: number;
    };

    const adminAuth = resolveAdminAuthority({ ...userRow, session_id: sess.sessionId });
    const botSettings = getBotSettings();
    const activeChannels = getForcedChannels().filter((c) => c.enabled);

    let channelsVerified = activeChannels.length === 0 || adminAuth.isAdmin;
    let channels: { id: string; chatId: string; title: string; inviteUrl: string; joined: boolean }[] =
      activeChannels.map((c) => ({
        id: c.id,
        chatId: c.chatId,
        title: c.title,
        inviteUrl: c.inviteUrl,
        joined: false,
      }));
    if (activeChannels.length > 0 && !adminAuth.isAdmin) {
      const check = await verifyForcedChannelMembership(verified.user.id);
      channelsVerified = check.allJoined;
      channels = check.channels;
      if (channelsVerified) {
        db.prepare("UPDATE users SET channel_verified_at = datetime('now') WHERE id = ?").run(upserted.userId);
      }
    }

    const phoneShared = Boolean(userRow.phone_verified);
    const needsContactShare = !adminAuth.isAdmin && botSettings.requirePhoneContact && !phoneShared;

    return NextResponse.json({
      token: sess.token,
      currentSessionId: sess.sessionId,
      botUsername: getBotUsername(),
      previewAvailable: process.env.NODE_ENV !== 'production',
      isAdmin: adminAuth.isAdmin,
      isPrimaryAdmin: adminAuth.isPrimaryAdmin,
      adminRole: adminAuth.role,
      onboarding: {
        channelsVerified,
        channels,
        phoneShared,
        needsContactShare,
        onboardingCompleted: channelsVerified && !needsContactShare,
      },
      ...bundle,
    });
  } catch (err) {
    logSystemError('auth_session_post', 'Telegram auth failed', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'خطای داخلی در پردازش ورود تلگرام.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'ابتدا وارد حساب کاربری شوید.' }, { status: 401 });

  const db = getDb();
  const scope = req.nextUrl.searchParams.get('scope') || 'current';

  if (scope === 'others') {
    db.prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ? AND id != ?').run(auth.id, auth.session_id);
    return NextResponse.json({ ok: true, message: 'تمام نشست‌های دیگر بسته شدند.' });
  }

  if (scope === 'delete_account') {
    db.transaction(() => {
      db.prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?').run(auth.id);
      db.prepare(
        "UPDATE users SET is_deleted = 1, phone = NULL, phone_verified = 0, password_hash = NULL, display_name = 'کاربر حذف‌شده' WHERE id = ?"
      ).run(auth.id);
    })();
    return NextResponse.json({ ok: true, message: 'حساب کاربری و اطلاعات خصوصی شما حذف شد.' });
  }

  db.prepare('UPDATE user_sessions SET revoked = 1 WHERE id = ?').run(auth.session_id);
  return NextResponse.json({ ok: true, message: 'از حساب کاربری خارج شدید.' });
}
