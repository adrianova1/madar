import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { adjustStarsAtomic, getDb } from '@/lib/db';
import {
  checkRateLimit,
  createAdminSession,
  getAdminSession,
  getClientIp,
  hashPassword,
  verifyPassword,
  writeAuditLog,
} from '@/lib/security';

const AdminActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('claim'),
    username: z.string().min(3).max(32).default('superadmin'),
    password: z.string().min(8, 'رمز مدیریت باید حداقل ۸ کاراکتر باشد').max(128),
  }),
  z.object({
    action: z.literal('login'),
    username: z.string().min(1).max(40),
    password: z.string().min(1).max(128),
    role: z.enum(['Super Admin', 'Admin', 'Moderator', 'Support', 'Content Manager', 'Game Manager']).optional(),
  }),
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
    questions: z.array(
      z.object({
        category: z.string().min(2).max(40),
        question: z.string().min(6).max(240),
        options: z.array(z.string().min(1).max(80)).length(4),
        correctIndex: z.number().int().min(0).max(3),
        difficulty: z.string().max(20).default('متوسط'),
      })
    ).min(1).max(50),
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
]);

function safeCompareSecret(input: string, envSecret: string): boolean {
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(envSecret).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const envPasscode = process.env.MADAR_ADMIN_PASSCODE?.trim() || '';
  const claimedRow = db.prepare('SELECT username, role, claimed_at FROM admin_credentials WHERE id = 1').get() as
    | { username: string; role: string; claimed_at: string }
    | undefined;

  const adminSess = getAdminSession(req);
  if (!adminSess) {
    return NextResponse.json({
      authenticated: false,
      envPasscodeConfigured: Boolean(envPasscode),
      needsFirstRunClaim: !envPasscode && !claimedRow,
    });
  }

  const search = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';

  const stats = {
    totalUsers: (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_deleted = 0').get() as { c: number }).c,
    verifiedUsers: (db.prepare('SELECT COUNT(*) as c FROM users WHERE phone_verified = 1 AND is_deleted = 0').get() as { c: number }).c,
    activeMatches: (db.prepare("SELECT COUNT(*) as c FROM matches WHERE status = 'active'").get() as { c: number }).c,
    totalGames: (db.prepare('SELECT COUNT(*) as c FROM game_history').get() as { c: number }).c,
    totalGroups: (db.prepare('SELECT COUNT(*) as c FROM telegram_groups').get() as { c: number }).c,
    totalWhispers: (db.prepare('SELECT COUNT(*) as c FROM whispers').get() as { c: number }).c,
    aiCallsCount: (db.prepare('SELECT COUNT(*) as c FROM ai_usage_logs').get() as { c: number }).c,
    openReports: (db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'open'").get() as { c: number }).c,
  };

  const users = search
    ? db
        .prepare(`
          SELECT u.id, u.username, u.display_name, u.phone_verified, u.subscription_tier, u.level, u.is_banned, u.created_at,
                 p.city, w.free_stars, w.paid_stars
          FROM users u
          JOIN user_profiles p ON p.user_id = u.id
          JOIN star_wallets w ON w.user_id = u.id
          WHERE u.is_deleted = 0 AND (lower(u.username) LIKE ? OR lower(u.display_name) LIKE ?)
          ORDER BY u.id DESC LIMIT 30
        `)
        .all(`%${search}%`, `%${search}%`)
    : db
        .prepare(`
          SELECT u.id, u.username, u.display_name, u.phone_verified, u.subscription_tier, u.level, u.is_banned, u.created_at,
                 p.city, w.free_stars, w.paid_stars
          FROM users u
          JOIN user_profiles p ON p.user_id = u.id
          JOIN star_wallets w ON w.user_id = u.id
          WHERE u.is_deleted = 0
          ORDER BY u.id DESC LIMIT 30
        `)
        .all();

  const planetsRow = db.prepare("SELECT value_json FROM system_settings WHERE key = 'planets'").get() as
    | { value_json: string }
    | undefined;

  const reports = db
    .prepare('SELECT id, reporter_id, target_type, target_id, reason, status, created_at FROM reports ORDER BY id DESC LIMIT 20')
    .all();

  const auditLogs = db
    .prepare('SELECT id, admin_username, admin_role, action, target, details, created_at FROM audit_logs ORDER BY id DESC LIMIT 30')
    .all();

  const aiLogs = db
    .prepare('SELECT id, model, prompt_chars, response_chars, status, created_at FROM ai_usage_logs ORDER BY id DESC LIMIT 15')
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

  return NextResponse.json({
    authenticated: true,
    admin: adminSess,
    stats,
    users,
    planets: planetsRow ? JSON.parse(planetsRow.value_json) : [],
    reports,
    adultVerifications,
    auditLogs,
    aiLogs,
    contentCounts: { quizCount, tdCount },
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`admin:${ip}`, 25, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'تعداد درخواست‌های پنل مدیریت بیش از حد مجاز است.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = AdminActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'اطلاعات نامعتبر است.' }, { status: 400 });
  }

  const db = getDb();
  const data = parsed.data;
  const envPasscode = process.env.MADAR_ADMIN_PASSCODE?.trim() || '';

  if (data.action === 'claim') {
    if (envPasscode) {
      return NextResponse.json({ error: 'گذرواژه مدیریت در متغیر محیطی سرور تنظیم شده است؛ مستقیماً وارد شوید.' }, { status: 403 });
    }
    const existing = db.prepare('SELECT 1 FROM admin_credentials WHERE id = 1').get();
    if (existing) {
      return NextResponse.json({ error: 'حساب مدیر ارشد قبلاً ثبت و قفل شده است. با فرم ورود وارد شوید.' }, { status: 409 });
    }

    const hash = hashPassword(data.password);
    const uname = data.username.trim();
    db.prepare("INSERT INTO admin_credentials (id, username, password_hash, role) VALUES (1, ?, ?, 'Super Admin')").run(uname, hash);
    writeAuditLog(uname, 'Super Admin', 'ADMIN_BOOTSTRAP_CLAIM', 'admin_credentials', 'اولین مدیر ارشد ثبت و مسیر راه‌اندازی قفل شد.');
    const adminToken = createAdminSession(uname, 'Super Admin');
    return NextResponse.json({ ok: true, adminToken, admin: { username: uname, role: 'Super Admin' } }, { status: 201 });
  }

  if (data.action === 'login') {
    const claimedRow = db.prepare('SELECT username, password_hash, role FROM admin_credentials WHERE id = 1').get() as
      | { username: string; password_hash: string; role: string }
      | undefined;

    let valid = false;
    let role: string = data.role || 'Super Admin';
    if (envPasscode) {
      valid = safeCompareSecret(data.password, envPasscode);
    } else if (claimedRow) {
      valid =
        claimedRow.username.toLowerCase() === data.username.trim().toLowerCase() &&
        verifyPassword(data.password, claimedRow.password_hash);
      role = data.role || claimedRow.role;
    }

    if (!valid) {
      return NextResponse.json({ error: 'نام کاربری یا رمز عبور مدیریت نادرست است.' }, { status: 401 });
    }

    const adminToken = createAdminSession(data.username.trim(), role);
    writeAuditLog(data.username.trim(), role, 'ADMIN_LOGIN', 'admin_panel', `ورود از IP ${ip}`);
    return NextResponse.json({ ok: true, adminToken, admin: { username: data.username.trim(), role } });
  }

  // All subsequent operations require verified Admin session
  const adminSess = getAdminSession(req);
  if (!adminSess) {
    return NextResponse.json({ error: 'احراز هویت مدیر الزامی است.' }, { status: 401 });
  }

  if (data.action === 'ban_user') {
    db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(data.banned ? 1 : 0, data.userId);
    if (data.banned) {
      db.prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?').run(data.userId);
    }
    writeAuditLog(adminSess.username, adminSess.role, data.banned ? 'USER_BAN' : 'USER_UNBAN', `user:${data.userId}`);
    return NextResponse.json({ ok: true, message: data.banned ? 'کاربر مسدود شد.' : 'مسدودیت کاربر برداشته شد.' });
  }

  if (data.action === 'adjust_stars') {
    try {
      const w = adjustStarsAtomic(data.userId, data.delta, 'free', 'admin_adjustment', `تعدیل مدیریت: ${data.reason}`);
      writeAuditLog(adminSess.username, adminSess.role, 'STAR_ADJUST', `user:${data.userId}`, `${data.delta} | ${data.reason}`);
      return NextResponse.json({ ok: true, wallet: w, message: 'موجودی ستاره کاربر با ثبت در دفتر کل به‌روز شد.' });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'خطا در تعدیل ستاره' }, { status: 400 });
    }
  }

  if (data.action === 'update_tier') {
    db.prepare('UPDATE users SET subscription_tier = ? WHERE id = ?').run(data.tier, data.userId);
    writeAuditLog(adminSess.username, adminSess.role, 'SUBSCRIPTION_CHANGE', `user:${data.userId}`, `tier=${data.tier}`);
    return NextResponse.json({ ok: true, message: 'سطح اشتراک کاربر تغییر کرد.' });
  }

  if (data.action === 'update_planets') {
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES ('planets', ?, datetime('now'))").run(
      JSON.stringify(data.planets)
    );
    writeAuditLog(adminSess.username, adminSess.role, 'PLANETS_UPDATE', 'system_settings', `${data.planets.length} سیاره به‌روز شد`);
    return NextResponse.json({ ok: true, message: 'چیدمان و عناوین سیارات مدار ذخیره شد.' });
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
    writeAuditLog(adminSess.username, adminSess.role, 'QUIZ_BULK_IMPORT', 'quiz_questions', `${data.questions.length} سؤال افزوده شد`);
    return NextResponse.json({ ok: true, message: `${data.questions.length} سؤال جدید به بانک کوییز عطارد اضافه شد.` });
  }

  if (data.action === 'add_td_prompt') {
    db.prepare('INSERT INTO truth_dare_prompts (mode, category, text, is_adult) VALUES (?, ?, ?, ?)').run(
      data.mode,
      data.category,
      data.text,
      data.isAdult ? 1 : 0
    );
    writeAuditLog(adminSess.username, adminSess.role, 'TD_ADD_PROMPT', 'truth_dare_prompts', `${data.mode} / ${data.category}`);
    return NextResponse.json({ ok: true, message: 'آیتم جدید جرئت و حقیقت به سیاره مریخ اضافه شد.' });
  }

  if (data.action === 'resolve_report') {
    db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(data.status, data.reportId);
    writeAuditLog(adminSess.username, adminSess.role, 'REPORT_RESOLVE', `report:${data.reportId}`, data.status);
    return NextResponse.json({ ok: true, message: 'وضعیت گزارش تخلف به‌روزرسانی شد.' });
  }

  if (data.action === 'review_adult_verification') {
    db.prepare(`
      UPDATE adult_verifications
      SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ?
    `).run(data.decision, adminSess.username, data.userId);

    db.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'security', ?, ?)").run(
      data.userId,
      data.decision === 'verified' ? 'احراز سن ۱۸+ تأیید شد' : 'درخواست احراز سن ۱۸+ رد شد',
      data.decision === 'verified'
        ? 'درخواست احراز سن و رضایت‌نامه ۱۸+ شما تأیید شد. اکنون می‌توانید با اختیار کامل به محتوای مجاز بزرگسالان دسترسی داشته باشید.'
        : 'درخواست احراز سن ۱۸+ شما تأیید نشد. دسترسی بزرگسالان همچنان قفل است.'
    );

    writeAuditLog(
      adminSess.username,
      adminSess.role,
      'ADULT_VERIFICATION_REVIEW',
      `user:${data.userId}`,
      data.decision
    );
    return NextResponse.json({
      ok: true,
      message: data.decision === 'verified' ? 'درخواست احراز سن ۱۸+ تأیید شد.' : 'درخواست احراز سن ۱۸+ رد شد.',
    });
  }

  return NextResponse.json({ error: 'عملیات ناشناخته' }, { status: 400 });
}
