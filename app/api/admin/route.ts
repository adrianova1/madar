import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adjustStarsAtomic, getDb } from '@/lib/db';
import {
  checkRateLimit,
  DelegatedAdminEntry,
  getAuthUser,
  getClientIp,
  getDelegatedAdmins,
  isSessionSecretConfigured,
  resolveAdminAuthority,
  writeAuditLog,
} from '@/lib/security';
import { ForcedChannelConfig, getBotUsername, getForcedChannels } from '@/lib/telegram-bot';

const AdminActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('ban_user'),
    userId: z.number().int().positive(),
    banned: z.boolean(),
  }),
  z.object({
    action: z.literal('adjust_stars'),
    userId: z.number().int().positive(),
    delta: z.number().int().min(-5000).max(5000),
    reason: z.string().min(2).max(120),
  }),
  z.object({
    action: z.literal('update_tier'),
    userId: z.number().int().positive(),
    tier: z.enum(['free', 'plus', 'vip']),
  }),
  z.object({
    action: z.literal('update_planets'),
    planets: z.array(
      z.object({
        id: z.string().min(1).max(20),
        name: z.string().min(1).max(30),
        subtitle: z.string().min(1).max(60),
        target: z.string().min(1).max(30),
        color: z.string().min(4).max(20),
        image: z.string().max(120),
      })
    ),
  }),
  z.object({
    action: z.literal('import_quiz'),
    questions: z
      .array(
        z.object({
          category: z.string().min(2).max(40),
          question: z.string().min(6).max(240),
          options: z.array(z.string().min(1).max(80)).length(4),
          correctIndex: z.number().int().min(0).max(3),
          difficulty: z.string().max(20).default('متوسط'),
        })
      )
      .min(1)
      .max(50),
  }),
  z.object({
    action: z.literal('add_td_prompt'),
    mode: z.enum(['truth', 'dare']),
    category: z.string().min(2).max(30),
    text: z.string().min(6).max(280),
    isAdult: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('resolve_report'),
    reportId: z.number().int().positive(),
    status: z.enum(['resolved', 'dismissed']),
  }),
  z.object({
    action: z.literal('review_adult_verification'),
    userId: z.number().int().positive(),
    decision: z.enum(['verified', 'rejected']),
  }),
  z.object({
    action: z.literal('update_forced_channels'),
    channels: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          chatId: z.string().min(2).max(80),
          title: z.string().min(1).max(80),
          inviteUrl: z
            .string()
            .url()
            .refine((u) => /^https:\/\/t\.me\//i.test(u), 'لینک کانال باید با https://t.me/ شروع شود'),
          enabled: z.boolean(),
        })
      )
      .max(10),
  }),
  z.object({
    action: z.literal('update_bot_settings'),
    welcomeText: z.string().min(2).max(300),
    requirePhoneContact: z.boolean(),
    maintenanceMode: z.boolean(),
  }),
  z.object({
    action: z.literal('toggle_group_rule'),
    groupId: z.number().int().positive(),
    field: z.enum(['anti_link', 'anti_ads', 'anti_spam', 'anti_flood', 'anti_tabchi', 'lock_media']),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal('cleanup_stale_rooms'),
  }),
  z.object({
    action: z.literal('clear_error_logs'),
  }),
  z.object({
    action: z.literal('add_delegated_admin'),
    telegramId: z.string().regex(/^\d{5,20}$/, 'شناسه عددی تلگرام معتبر وارد کنید'),
    label: z.string().min(2).max(40),
    role: z.enum(['Admin', 'Moderator', 'Support', 'Content Manager', 'Game Manager']),
  }),
  z.object({
    action: z.literal('remove_delegated_admin'),
    telegramId: z.string().regex(/^\d{5,20}$/),
  }),
]);

function requireVerifiedAdmin(req: NextRequest) {
  const auth = getAuthUser(req);
  if (!auth) {
    return { ok: false as const, response: NextResponse.json({ error: 'احراز هویت تلگرام الزامی است.' }, { status: 401 }) };
  }
  const authority = resolveAdminAuthority(auth);
  if (!authority.isAdmin) {
    return { ok: false as const, response: NextResponse.json({ error: 'دسترسی غیرمجاز.' }, { status: 403 }) };
  }
  return { ok: true as const, auth, authority };
}

export async function GET(req: NextRequest) {
  const gate = requireVerifiedAdmin(req);
  if (!gate.ok) return gate.response;

  const { auth, authority } = gate;
  const db = getDb();
  const search = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';

  const stats = {
    totalUsers: (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_deleted = 0').get() as { c: number }).c,
    verifiedUsers: (db.prepare('SELECT COUNT(*) as c FROM users WHERE phone_verified = 1 AND is_deleted = 0').get() as { c: number }).c,
    activeMatches: (db.prepare("SELECT COUNT(*) as c FROM matches WHERE status = 'active'").get() as { c: number }).c,
    totalGames: (db.prepare('SELECT COUNT(*) as c FROM game_history').get() as { c: number }).c,
    activeRooms: (db.prepare("SELECT COUNT(*) as c FROM engine_rooms WHERE status != 'finished'").get() as { c: number }).c,
    totalGroups: (db.prepare('SELECT COUNT(*) as c FROM telegram_groups').get() as { c: number }).c,
    totalWhispers: (db.prepare('SELECT COUNT(*) as c FROM whispers').get() as { c: number }).c,
    openReports: (db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'open'").get() as { c: number }).c,
    errorCount: (db.prepare('SELECT COUNT(*) as c FROM system_error_logs').get() as { c: number }).c,
  };

  const users = search
    ? db
        .prepare(`
          SELECT u.id, u.telegram_id, u.username, u.display_name, u.phone_verified, u.onboarding_completed,
                 u.subscription_tier, u.level, u.is_banned, u.created_at, u.last_login_at,
                 p.city, w.free_stars, w.paid_stars
          FROM users u
          JOIN user_profiles p ON p.user_id = u.id
          JOIN star_wallets w ON w.user_id = u.id
          WHERE u.is_deleted = 0 AND (lower(u.username) LIKE ? OR lower(u.display_name) LIKE ? OR u.telegram_id LIKE ?)
          ORDER BY u.id DESC LIMIT 40
        `)
        .all(`%${search}%`, `%${search}%`, `%${search}%`)
    : db
        .prepare(`
          SELECT u.id, u.telegram_id, u.username, u.display_name, u.phone_verified, u.onboarding_completed,
                 u.subscription_tier, u.level, u.is_banned, u.created_at, u.last_login_at,
                 p.city, w.free_stars, w.paid_stars
          FROM users u
          JOIN user_profiles p ON p.user_id = u.id
          JOIN star_wallets w ON w.user_id = u.id
          WHERE u.is_deleted = 0
          ORDER BY u.id DESC LIMIT 40
        `)
        .all();

  const groups = db
    .prepare(`
      SELECT id, chat_id, title, member_count, bot_is_admin, anti_link, anti_ads, anti_spam, anti_flood, anti_tabchi, lock_media, sensitivity_level
      FROM telegram_groups
      ORDER BY id DESC LIMIT 30
    `)
    .all();

  const moderationLogs = db
    .prepare('SELECT id, group_id, command, target_label, reason, actor_label, created_at FROM moderation_logs ORDER BY id DESC LIMIT 25')
    .all();

  const activeEngineRooms = db
    .prepare('SELECT room_code, game_type, is_hangout, status, created_at, updated_at FROM engine_rooms ORDER BY updated_at DESC LIMIT 25')
    .all();

  const planetsRow = db.prepare("SELECT value_json FROM system_settings WHERE key = 'planets'").get() as
    | { value_json: string }
    | undefined;
  const botSettingsRow = db.prepare("SELECT value_json FROM system_settings WHERE key = 'bot_settings'").get() as
    | { value_json: string }
    | undefined;

  const reports = db
    .prepare('SELECT id, reporter_id, target_type, target_id, reason, status, created_at FROM reports ORDER BY id DESC LIMIT 25')
    .all();

  const auditLogs = db
    .prepare('SELECT id, admin_username, admin_role, action, target, details, created_at FROM audit_logs ORDER BY id DESC LIMIT 30')
    .all();

  const errorLogs = db
    .prepare('SELECT id, source, message, details, created_at FROM system_error_logs ORDER BY id DESC LIMIT 30')
    .all();

  const quizCount = (db.prepare('SELECT COUNT(*) as c FROM quiz_questions').get() as { c: number }).c;
  const tdCount = (db.prepare('SELECT COUNT(*) as c FROM truth_dare_prompts').get() as { c: number }).c;
  const adultVerifications = db
    .prepare(`
      SELECT av.user_id, av.status, av.phone_confirmed, av.consent_accepted, av.verification_note,
             av.reviewed_by, av.reviewed_at, av.updated_at,
             u.username, u.display_name, u.phone_verified, p.birth_date
      FROM adult_verifications av
      JOIN users u ON u.id = av.user_id
      JOIN user_profiles p ON p.user_id = u.id
      ORDER BY CASE WHEN av.status = 'pending_review' THEN 0 ELSE 1 END, av.updated_at DESC
      LIMIT 25
    `)
    .all();

  const forcedChannels: ForcedChannelConfig[] = getForcedChannels();
  const delegatedAdmins: DelegatedAdminEntry[] = getDelegatedAdmins();

  return NextResponse.json({
    authenticated: true,
    admin: {
      username: auth.username,
      displayName: auth.display_name,
      telegramId: auth.telegram_id,
      role: authority.role,
      isPrimaryAdmin: authority.isPrimaryAdmin,
    },
    stats,
    users,
    groups,
    moderationLogs,
    activeEngineRooms,
    planets: planetsRow ? JSON.parse(planetsRow.value_json) : [],
    botSettings: botSettingsRow
      ? JSON.parse(botSettingsRow.value_json)
      : { welcomeText: 'به مدار خوش آمدی.', requirePhoneContact: true, maintenanceMode: false },
    forcedChannels,
    delegatedAdmins,
    reports,
    adultVerifications,
    auditLogs,
    errorLogs,
    contentCounts: { quizCount, tdCount },
    systemStatus: {
      nodeEnv: process.env.NODE_ENV || 'development',
      botUsername: getBotUsername(),
      hasBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
      hasWebhookSecret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim()),
      hasSessionSecret: isSessionSecretConfigured(),
      hasAdminTelegramId: Boolean(process.env.ADMIN_TELEGRAM_ID?.trim()),
      previewDisabledInProd: process.env.NODE_ENV === 'production',
    },
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`admin:${ip}`, 40, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'تعداد درخواست‌های پنل مدیریت بیش از حد مجاز است.' }, { status: 429 });
  }

  const gate = requireVerifiedAdmin(req);
  if (!gate.ok) return gate.response;

  const { auth, authority } = gate;
  const adminActor = auth.username;
  const adminRole = authority.role || 'Admin';

  const body = await req.json().catch(() => null);
  const parsed = AdminActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'اطلاعات نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();
  const data = parsed.data;

  if (data.action === 'ban_user') {
    db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(data.banned ? 1 : 0, data.userId);
    if (data.banned) {
      db.prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?').run(data.userId);
    }
    writeAuditLog(adminActor, adminRole, data.banned ? 'USER_BAN' : 'USER_UNBAN', `user:${data.userId}`);
    return NextResponse.json({ ok: true, message: data.banned ? 'کاربر مسدود شد.' : 'مسدودیت کاربر برداشته شد.' });
  }

  if (data.action === 'adjust_stars') {
    try {
      const w = adjustStarsAtomic(data.userId, data.delta, 'free', 'admin_adjustment', `تعدیل مدیریت: ${data.reason}`);
      writeAuditLog(adminActor, adminRole, 'STAR_ADJUST', `user:${data.userId}`, `${data.delta} | ${data.reason}`);
      return NextResponse.json({ ok: true, wallet: w, message: 'موجودی ستاره کاربر به‌روز شد.' });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'خطا در تعدیل ستاره' }, { status: 400 });
    }
  }

  if (data.action === 'update_tier') {
    db.prepare('UPDATE users SET subscription_tier = ? WHERE id = ?').run(data.tier, data.userId);
    writeAuditLog(adminActor, adminRole, 'SUBSCRIPTION_CHANGE', `user:${data.userId}`, `tier=${data.tier}`);
    return NextResponse.json({ ok: true, message: 'سطح اشتراک کاربر تغییر کرد.' });
  }

  if (data.action === 'update_planets') {
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('planets', ?, datetime('now'))").run(
      JSON.stringify(data.planets)
    );
    writeAuditLog(adminActor, adminRole, 'PLANETS_UPDATE', 'system_settings', `${data.planets.length} سیاره`);
    return NextResponse.json({ ok: true, message: 'چیدمان سیارات ذخیره شد.' });
  }

  if (data.action === 'import_quiz') {
    const insert = db.prepare(
      'INSERT INTO quiz_questions (category, question, options_json, correct_index, difficulty) VALUES (?, ?, ?, ?, ?)'
    );
    db.transaction(() => {
      for (const q of data.questions) {
        insert.run(q.category, q.question, JSON.stringify(q.options), q.correctIndex, q.difficulty);
      }
    })();
    writeAuditLog(adminActor, adminRole, 'QUIZ_BULK_IMPORT', 'quiz_questions', `${data.questions.length} سؤال`);
    return NextResponse.json({ ok: true, message: `${data.questions.length} سؤال جدید اضافه شد.` });
  }

  if (data.action === 'add_td_prompt') {
    db.prepare('INSERT INTO truth_dare_prompts (mode, category, text, is_adult) VALUES (?, ?, ?, ?)').run(
      data.mode,
      data.category,
      data.text,
      data.isAdult ? 1 : 0
    );
    writeAuditLog(adminActor, adminRole, 'TD_ADD_PROMPT', 'truth_dare_prompts', `${data.mode} / ${data.category}`);
    return NextResponse.json({ ok: true, message: 'مورد جدید جرئت و حقیقت ثبت شد.' });
  }

  if (data.action === 'resolve_report') {
    db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(data.status, data.reportId);
    writeAuditLog(adminActor, adminRole, 'REPORT_RESOLVE', `report:${data.reportId}`, data.status);
    return NextResponse.json({ ok: true, message: 'وضعیت گزارش تخلف به‌روزرسانی شد.' });
  }

  if (data.action === 'review_adult_verification') {
    db.prepare(`
      UPDATE adult_verifications
      SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ?
    `).run(data.decision, adminActor, data.userId);

    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'security', ?, ?)").run(
      data.userId,
      data.decision === 'verified' ? 'احراز سن ۱۸+ تأیید شد' : 'درخواست احراز سن ۱۸+ رد شد',
      data.decision === 'verified'
        ? 'درخواست احراز سن ۱۸+ شما تأیید شد.'
        : 'درخواست احراز سن ۱۸+ شما تأیید نشد.'
    );

    writeAuditLog(adminActor, adminRole, 'ADULT_VERIFICATION_REVIEW', `user:${data.userId}`, data.decision);
    return NextResponse.json({
      ok: true,
      message: data.decision === 'verified' ? 'درخواست احراز ۱۸+ تأیید شد.' : 'درخواست احراز ۱۸+ رد شد.',
    });
  }

  if (data.action === 'update_forced_channels') {
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('forced_channels', ?, datetime('now'))").run(
      JSON.stringify(data.channels)
    );
    writeAuditLog(adminActor, adminRole, 'FORCED_CHANNELS_UPDATE', 'system_settings', `${data.channels.length} کانال`);
    return NextResponse.json({ ok: true, message: 'تنظیمات عضویت اجباری کانال‌ها ذخیره شد.' });
  }

  if (data.action === 'update_bot_settings') {
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('bot_settings', ?, datetime('now'))").run(
      JSON.stringify({
        welcomeText: data.welcomeText.trim(),
        requirePhoneContact: data.requirePhoneContact,
        maintenanceMode: data.maintenanceMode,
      })
    );
    writeAuditLog(adminActor, adminRole, 'BOT_SETTINGS_UPDATE', 'system_settings', `requirePhone=${data.requirePhoneContact}`);
    return NextResponse.json({ ok: true, message: 'تنظیمات ربات ذخیره شد.' });
  }

  if (data.action === 'toggle_group_rule') {
    const allowedColumns: Record<string, string> = {
      anti_link: 'anti_link',
      anti_ads: 'anti_ads',
      anti_spam: 'anti_spam',
      anti_flood: 'anti_flood',
      anti_tabchi: 'anti_tabchi',
      lock_media: 'lock_media',
    };
    const col = allowedColumns[data.field];
    db.prepare(`UPDATE telegram_groups SET ${col} = ? WHERE id = ?`).run(data.enabled ? 1 : 0, data.groupId);
    writeAuditLog(adminActor, adminRole, 'GROUP_RULE_TOGGLE', `group:${data.groupId}`, `${col}=${data.enabled}`);
    return NextResponse.json({ ok: true, message: 'تنظیم گروه به‌روزرسانی شد.' });
  }

  if (data.action === 'cleanup_stale_rooms') {
    const res = db.prepare("DELETE FROM engine_rooms WHERE expires_at < datetime('now') OR status = 'finished'").run();
    writeAuditLog(adminActor, adminRole, 'ROOMS_CLEANUP', 'engine_rooms', `${res.changes} اتاق پاک شد`);
    return NextResponse.json({ ok: true, message: `${res.changes} اتاق قدیمی و پایان‌یافته پاک‌سازی شد.` });
  }

  if (data.action === 'clear_error_logs') {
    db.prepare('DELETE FROM system_error_logs').run();
    writeAuditLog(adminActor, adminRole, 'CLEAR_ERROR_LOGS', 'system_error_logs');
    return NextResponse.json({ ok: true, message: 'گزارش خطاها پاک شد.' });
  }

  if (data.action === 'add_delegated_admin' || data.action === 'remove_delegated_admin') {
    if (!authority.isPrimaryAdmin) {
      return NextResponse.json({ error: 'فقط مدیر اصلی مجاز به مدیریت دسترسی ادمین‌ها است.' }, { status: 403 });
    }
    const list = getDelegatedAdmins();
    let updated: DelegatedAdminEntry[];
    if (data.action === 'add_delegated_admin') {
      updated = [
        ...list.filter((item) => item.telegramId !== data.telegramId),
        {
          telegramId: data.telegramId,
          label: data.label.trim(),
          role: data.role,
          addedAt: new Date().toISOString(),
        },
      ];
      writeAuditLog(adminActor, adminRole, 'ADMIN_ADD', `tg:${data.telegramId}`, `${data.label} (${data.role})`);
    } else {
      updated = list.filter((item) => item.telegramId !== data.telegramId);
      writeAuditLog(adminActor, adminRole, 'ADMIN_REMOVE', `tg:${data.telegramId}`);
    }
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('delegated_admins', ?, datetime('now'))").run(
      JSON.stringify(updated)
    );
    return NextResponse.json({ ok: true, delegatedAdmins: updated, message: 'فهرست دسترسی ادمین‌ها به‌روز شد.' });
  }

  return NextResponse.json({ error: 'عملیات ناشناخته' }, { status: 400 });
}
