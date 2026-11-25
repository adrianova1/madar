'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  Globe,
  Lock,
  Plus,
  Search,
  Server,
  Shield,
  Sliders,
  Upload,
} from 'lucide-react';
import type { PlanetConfig } from './types';

interface AdminUserRow {
  id: number;
  username: string;
  display_name: string;
  phone_verified: number;
  subscription_tier: 'free' | 'plus' | 'vip';
  level: number;
  is_banned: number;
  city: string;
  free_stars: number;
  paid_stars: number;
}

interface AuditLogRow {
  id: number;
  admin_username: string;
  admin_role: string;
  action: string;
  target: string;
  details: string;
  created_at: string;
}

interface ReportRow {
  id: number;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  created_at: string;
}

interface AdultVerificationRow {
  user_id: number;
  username: string;
  display_name: string;
  phone_verified: number;
  birth_date: string | null;
  status: string;
  consent_accepted: number;
  verification_note: string;
  updated_at: string;
}

interface AdminConsoleProps {
  onPlanetsUpdated: () => Promise<void>;
}

export default function AdminConsole({ onPlanetsUpdated }: AdminConsoleProps) {
  // Admin Bearer token strictly in React memory (never localStorage)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [needsClaim, setNeedsClaim] = useState(false);
  const [envConfigured, setEnvConfigured] = useState(false);

  const [username, setUsername] = useState('superadmin');
  const [password, setPassword] = useState('');
  const [roleSelect, setRoleSelect] = useState<'Super Admin' | 'Admin' | 'Moderator' | 'Support' | 'Content Manager' | 'Game Manager'>('Super Admin');
  const [authError, setAuthError] = useState<string | null>(null);

  const [adminInfo, setAdminInfo] = useState<{ username: string; role: string } | null>(null);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [planets, setPlanets] = useState<PlanetConfig[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [adultVerifications, setAdultVerifications] = useState<AdultVerificationRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [contentCounts, setContentCounts] = useState({ quizCount: 0, tdCount: 0 });

  const [tab, setTab] = useState<'overview' | 'users' | 'planets' | 'content' | 'audit' | 'cpanel'>('overview');
  const [searchQ, setSearchQ] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // Content creators
  const [bulkQuizJson, setBulkQuizJson] = useState(
    JSON.stringify(
      [
        {
          category: 'اطلاعات عمومی',
          question: 'کدام سیاره به سیاره سرخ مشهور است؟',
          options: ['زهره', 'مریخ', 'عطارد', 'زحل'],
          correctIndex: 1,
          difficulty: 'آسان',
        },
      ],
      null,
      2
    )
  );
  const [tdMode, setTdMode] = useState<'truth' | 'dare'>('truth');
  const [tdCat, setTdCat] = useState('دوستانه');
  const [tdText, setTdText] = useState('');
  const [tdAdult, setTdAdult] = useState(false);

  const loadAdmin = useCallback(async () => {
    const qs = searchQ ? `?q=${encodeURIComponent(searchQ)}` : '';
    const res = await fetch(`/api/admin${qs}`, {
      headers: adminToken ? { 'X-Admin-Token': adminToken } : {},
    });
    const data = await res.json();
    if (!data.authenticated) {
      setNeedsClaim(Boolean(data.needsFirstRunClaim));
      setEnvConfigured(Boolean(data.envPasscodeConfigured));
      return;
    }
    setAdminInfo(data.admin);
    setStats(data.stats || {});
    setUsers(data.users || []);
    setPlanets(data.planets || []);
    setReports(data.reports || []);
    setAdultVerifications(data.adultVerifications || []);
    setAuditLogs(data.auditLogs || []);
    setContentCounts(data.contentCounts || { quizCount: 0, tdCount: 0 });
  }, [adminToken, searchQ]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await loadAdmin();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadAdmin]);

  async function handleAdminAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        needsClaim
          ? { action: 'claim', username, password }
          : { action: 'login', username, password, role: roleSelect }
      ),
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthError(data.error || 'خطا در احراز هویت مدیر');
      return;
    }
    setAdminToken(data.adminToken);
    setPassword('');
  }

  async function runAdminMutation(payload: Record<string, unknown>) {
    if (!adminToken) return;
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setNotice(data.message || data.error);
    if (res.ok) {
      await loadAdmin();
      if (payload.action === 'update_planets') {
        await onPlanetsUpdated();
      }
    }
  }

  async function handleBulkQuizImport() {
    try {
      const parsed = JSON.parse(bulkQuizJson);
      if (!Array.isArray(parsed)) {
        setNotice('ساختار JSON باید یک آرایه از سؤالات باشد.');
        return;
      }
      await runAdminMutation({ action: 'import_quiz', questions: parsed });
    } catch {
      setNotice('فرمت JSON معتبر نیست.');
    }
  }

  if (!adminToken || !adminInfo) {
    return (
      <div className="max-w-lg mx-auto rounded-3xl border border-slate-800 bg-[#0B1022] p-6 sm:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-sky-400/15 border border-sky-400/40 flex items-center justify-center text-sky-300">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">
              {needsClaim ? 'راه‌اندازی اولیه حساب مدیر ارشد مدار' : 'ورود به پنل مدیریت مدار (RBAC)'}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {needsClaim
                ? 'این مسیر فقط یک‌بار برای ثبت امن اولین مدیر ارشد فعال است و پس از ثبت قفل می‌شود.'
                : envConfigured
                  ? 'گذرواژه مدیریت از متغیر محیطی سرور (MADAR_ADMIN_PASSCODE) اعتبارسنجی می‌شود.'
                  : 'دسترسی اختصاصی با کنترل نقش و ثبت تمام عملیات در Audit Log'}
            </p>
          </div>
        </div>

        {authError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {authError}
          </div>
        )}

        <form onSubmit={handleAdminAuth} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-300 block">نام کاربری مدیر</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3.5 py-2.5 text-sm text-white dir-ltr text-left"
            />
          </div>

          {!needsClaim && (
            <div className="space-y-1">
              <label className="text-xs text-slate-300 block">نقش عملیاتی (RBAC)</label>
              <select
                value={roleSelect}
                onChange={(e) => setRoleSelect(e.target.value as typeof roleSelect)}
                className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3.5 py-2.5 text-sm text-white"
              >
                <option value="Super Admin">Super Admin</option>
                <option value="Admin">Admin</option>
                <option value="Moderator">Moderator</option>
                <option value="Support">Support</option>
                <option value="Content Manager">Content Manager</option>
                <option value="Game Manager">Game Manager</option>
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-slate-300 block">
              {needsClaim ? 'تعیین رمز عبور قوی (حداقل ۸ کاراکتر)' : 'رمز عبور مدیریت'}
            </label>
            <input
              type="password"
              required
              minLength={needsClaim ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3.5 py-2.5 text-sm text-white"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-amber-400 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-300 min-h-[46px]"
          >
            {needsClaim ? 'ثبت مدیر ارشد و قفل راه‌اندازی' : 'ورود امن به پنل مدیریت'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs text-sky-300">
            پنل مدیریت حرفه‌ای مدار · {adminInfo.username} ({adminInfo.role})
          </p>
          <h1 className="text-2xl font-bold text-white mt-0.5">مرکز کنترل، محتوا و زیرساخت</h1>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#0B1022] border border-slate-800 rounded-xl overflow-x-auto">
          {[
            { id: 'overview', label: 'داشبورد' },
            { id: 'users', label: 'کاربران' },
            { id: 'planets', label: 'سیارات' },
            { id: 'content', label: 'محتوای بازی‌ها' },
            { id: 'audit', label: 'گزارش‌ها و Audit' },
            { id: 'cpanel', label: 'استقرار cPanel' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 min-h-[38px] ${
                tab === t.id ? 'bg-sky-400 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-sky-400/40 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
          {notice}
        </div>
      )}

      {/* TAB 1: KPI OVERVIEW */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'کل کاربران فعال', val: stats.totalUsers ?? 0 },
            { label: 'کاربران تأییدشده (+98)', val: stats.verifiedUsers ?? 0 },
            { label: 'مچینگ‌های فعال ونوس', val: stats.activeMatches ?? 0 },
            { label: 'کل بازی‌های ثبت‌شده', val: stats.totalGames ?? 0 },
            { label: 'گروه‌های متصل زحل', val: stats.totalGroups ?? 0 },
            { label: 'پیام‌های ناشناس نپتون', val: stats.totalWhispers ?? 0 },
            { label: 'پاسخ‌های موتور بومی گروه', val: stats.aiCallsCount ?? 0 },
            { label: 'گزارش‌های باز تخلف', val: stats.openReports ?? 0 },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-1.5">
              <p className="text-xs text-slate-400">{kpi.label}</p>
              <p className="text-3xl font-bold font-mono tabular-nums text-white">{kpi.val}</p>
            </div>
          ))}
        </div>
      )}

      {/* TAB 2: USERS MANAGEMENT */}
      {tab === 'users' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="جست‌وجوی نام یا نام کاربری..."
                className="w-full rounded-xl border border-slate-700 bg-[#070B1A] pr-9 pl-3 py-2 text-sm text-white"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2.5 px-3">کاربر</th>
                  <th className="py-2.5 px-3">شهر</th>
                  <th className="py-2.5 px-3">ستاره</th>
                  <th className="py-2.5 px-3">اشتراک</th>
                  <th className="py-2.5 px-3">عملیات مدیریت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-3">
                      <p className="font-semibold text-white">{u.display_name}</p>
                      <p className="text-slate-400">@{u.username} {u.is_banned ? '· مسدود' : ''}</p>
                    </td>
                    <td className="py-3 px-3 text-slate-300">{u.city}</td>
                    <td className="py-3 px-3 font-mono tabular-nums text-amber-300">
                      {u.free_stars + u.paid_stars}
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={u.subscription_tier}
                        onChange={(e) =>
                          runAdminMutation({ action: 'update_tier', userId: u.id, tier: e.target.value })
                        }
                        className="rounded-lg border border-slate-700 bg-[#070B1A] px-2 py-1 text-xs text-white"
                      >
                        <option value="free">رایگان</option>
                        <option value="plus">مدار پلاس</option>
                        <option value="vip">مدار VIP</option>
                      </select>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            runAdminMutation({
                              action: 'adjust_stars',
                              userId: u.id,
                              delta: 50,
                              reason: 'پاداش مدیریتی',
                            })
                          }
                          className="rounded-lg border border-amber-400/40 px-2.5 py-1 text-amber-200 hover:bg-amber-400/15"
                        >
                          +۵۰ ستاره
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runAdminMutation({
                              action: 'ban_user',
                              userId: u.id,
                              banned: !u.is_banned,
                            })
                          }
                          className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-rose-200 hover:bg-rose-500/15"
                        >
                          {u.is_banned ? 'رفع مسدودیت' : 'مسدودسازی'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: PLANET CUSTOMIZATION */}
      {tab === 'planets' && (
        <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base font-bold text-white">
              <Globe className="w-5 h-5 text-sky-400" />
              <span>مدیریت نام و توضیحات سیارات صفحه اصلی</span>
            </div>
            <button
              type="button"
              onClick={() => runAdminMutation({ action: 'update_planets', planets })}
              className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-semibold text-slate-950 min-h-[40px]"
            >
              ذخیره و اعمال زنده روی منظومه
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {planets.map((p, idx) => (
              <div key={p.id} className="rounded-xl border border-slate-800 bg-[#070B1A] p-4 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">نام سیاره ({p.id})</label>
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => {
                      const next = [...planets];
                      next[idx] = { ...p, name: e.target.value };
                      setPlanets(next);
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-[#0B1022] px-3 py-2 text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">توضیح بخش</label>
                  <input
                    type="text"
                    value={p.subtitle}
                    onChange={(e) => {
                      const next = [...planets];
                      next[idx] = { ...p, subtitle: e.target.value };
                      setPlanets(next);
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-[#0B1022] px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: GAME CONTENT & BULK QUIZ IMPORT */}
      {tab === 'content' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Upload className="w-4 h-4 text-amber-400" />
                <span>ورود گروهی سؤالات کوییز (JSON)</span>
              </div>
              <span className="text-xs font-mono text-slate-400">بانک فعلی: {contentCounts.quizCount} سؤال</span>
            </div>
            <textarea
              rows={9}
              value={bulkQuizJson}
              onChange={(e) => setBulkQuizJson(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#070B1A] p-3 text-xs font-mono text-slate-100 dir-ltr text-left"
            />
            <button
              type="button"
              onClick={handleBulkQuizImport}
              className="rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-semibold text-slate-950 min-h-[42px]"
            >
              ایمپورت سؤالات به عطارد
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Plus className="w-4 h-4 text-orange-400" />
                <span>افزودن کارت جدید جرئت و حقیقت</span>
              </div>
              <span className="text-xs font-mono text-slate-400">مجموع: {contentCounts.tdCount} کارت</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <select
                value={tdMode}
                onChange={(e) => setTdMode(e.target.value as 'truth' | 'dare')}
                className="rounded-xl border border-slate-700 bg-[#070B1A] px-3 py-2 text-xs text-white"
              >
                <option value="truth">حقیقت (Truth)</option>
                <option value="dare">جرئت (Dare)</option>
              </select>
              <input
                type="text"
                value={tdCat}
                onChange={(e) => setTdCat(e.target.value)}
                placeholder="دسته‌بندی"
                className="rounded-xl border border-slate-700 bg-[#070B1A] px-3 py-2 text-xs text-white"
              />
            </div>

            <textarea
              rows={4}
              value={tdText}
              onChange={(e) => setTdText(e.target.value)}
              placeholder="متن سؤال یا چالش جدید..."
              className="w-full rounded-xl border border-slate-700 bg-[#070B1A] p-3 text-sm text-white"
            />

            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={tdAdult}
                onChange={(e) => setTdAdult(e.target.checked)}
                className="accent-rose-400"
              />
              <span>مخصوص بزرگسالان ۱۸+ (با قفل احراز سن سمت سرور)</span>
            </label>

            <button
              type="button"
              onClick={() => {
                if (!tdText.trim()) return;
                runAdminMutation({
                  action: 'add_td_prompt',
                  mode: tdMode,
                  category: tdCat,
                  text: tdText,
                  isAdult: tdAdult,
                });
                setTdText('');
              }}
              className="block rounded-xl bg-orange-400 px-5 py-2.5 text-xs font-semibold text-slate-950 min-h-[42px]"
            >
              ذخیره در سیاره مریخ
            </button>
          </div>
        </div>
      )}

      {/* TAB 5: 18+ VERIFICATION QUEUE, REPORTS & AUDIT LOGS */}
      {tab === 'audit' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-rose-500/30 bg-[#0B1022] p-5 space-y-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-rose-400" />
              <span>صف بررسی احراز سن و رضایت +۱۸ ({adultVerifications.length})</span>
            </h2>
            {adultVerifications.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">هنوز درخواست احراز سن +۱۸ در صف ثبت نشده است.</p>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {adultVerifications.map((av) => (
                  <div key={av.user_id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5">
                      <p className="text-white font-semibold">
                        {av.display_name} (@{av.username}) · تولد: {av.birth_date || '—'} · موبایل:{' '}
                        {av.phone_verified ? 'تأییدشده' : 'تأییدنشده'}
                      </p>
                      <p className="text-slate-400">{av.verification_note}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-amber-300">{av.status}</span>
                      <button
                        type="button"
                        onClick={() =>
                          runAdminMutation({
                            action: 'review_adult_verification',
                            userId: av.user_id,
                            decision: 'verified',
                          })
                        }
                        className="rounded-lg border border-emerald-400/40 px-2.5 py-1 text-emerald-200 hover:bg-emerald-400/15"
                      >
                        تأیید +۱۸
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runAdminMutation({
                            action: 'review_adult_verification',
                            userId: av.user_id,
                            decision: 'rejected',
                          })
                        }
                        className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-rose-200 hover:bg-rose-500/15"
                      >
                        رد درخواست
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-rose-400" />
                <span>صف گزارش‌های تخلف کاربران ({reports.length})</span>
              </h2>
              {reports.length === 0 ? (
                <p className="text-xs text-slate-400 py-4">گزارش تخلفی ثبت نشده است.</p>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {reports.map((r) => (
                    <div key={r.id} className="py-3 text-xs space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-white font-semibold">{r.target_type} #{r.target_id}</span>
                        <span className="text-amber-300">{r.status}</span>
                      </div>
                      <p className="text-slate-300">{r.reason}</p>
                      {r.status === 'open' && (
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => runAdminMutation({ action: 'resolve_report', reportId: r.id, status: 'resolved' })}
                            className="text-emerald-300 underline"
                          >
                            رسیدگی و بستن
                          </button>
                          <button
                            type="button"
                            onClick={() => runAdminMutation({ action: 'resolve_report', reportId: r.id, status: 'dismissed' })}
                            className="text-slate-400 underline"
                          >
                            رد گزارش
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span>لاگ امنیتی عملیات مدیران (Audit Log)</span>
              </h2>
              <div className="divide-y divide-slate-800/80 max-h-80 overflow-y-auto">
                {auditLogs.map((a) => (
                  <div key={a.id} className="py-2.5 text-xs space-y-0.5">
                    <div className="flex justify-between">
                      <span className="font-mono text-sky-300">{a.action}</span>
                      <span className="font-mono text-[10px] text-slate-500">{a.created_at.slice(0, 16)}</span>
                    </div>
                    <p className="text-slate-300">
                      {a.admin_username} ({a.admin_role}) ← {a.target} {a.details ? `· ${a.details}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: NODE.JS CPANEL / VPS DEPLOYMENT ARCHITECTURE */}
      {tab === 'cpanel' && (
        <div className="rounded-2xl border border-[#23303E] bg-[#17212B] p-6 space-y-5">
          <div className="flex items-center gap-2 text-base font-bold text-white">
            <Server className="w-5 h-5 text-[#38BDF8]" />
            <span>نقشه استقرار واقعی روی cPanel (Node.js) و سرور VPS</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="rounded-xl border border-[#23303E] bg-[#0E1621] p-4 space-y-2">
              <p className="font-bold text-[#38BDF8]">مسیر داده امن و جداگانه</p>
              <p className="text-slate-300 leading-relaxed">
                مسیر دیتابیس SQLite از طریق متغیر <code className="font-mono text-sky-300">DATABASE_PATH</code> بیرون از <code className="font-mono">public_html</code> تنظیم می‌شود و در <code className="font-mono">.gitignore</code> مسدود است.
              </p>
            </div>
            <div className="rounded-xl border border-[#23303E] bg-[#0E1621] p-4 space-y-2">
              <p className="font-bold text-[#38BDF8]">نقطه ورود واقعی Node.js 20+</p>
              <p className="text-slate-300 leading-relaxed">
                فایل <code className="font-mono text-sky-300">cpanel-deploy/server.js</code> برای اجرای Next.js روی cPanel Node.js App یا PM2 در VPS آماده شده است. راهنمای محدودیت‌های RAM و <code className="font-mono">better-sqlite3</code> در <code className="font-mono">DEPLOY_CPANEL.md</code> درج شده است.
              </p>
            </div>
            <div className="rounded-xl border border-[#23303E] bg-[#0E1621] p-4 space-y-2">
              <p className="font-bold text-[#38BDF8]">موتور بومی بدون Gemini API</p>
              <p className="text-slate-300 leading-relaxed">
                ۱) توکن ربات تلگرام (<code className="font-mono">TELEGRAM_BOT_TOKEN</code> و <code className="font-mono">TELEGRAM_WEBHOOK_SECRET</code>) · ۲) درگاه پیامک برای OTP (<code className="font-mono">SMS_PROVIDER_URL</code>). بدون نیاز به هیچ API هوش مصنوعی خارجی.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#23303E] bg-[#0E1621] p-4 text-xs text-slate-300 space-y-1.5">
            <p className="font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-[#38BDF8]" />
              <span>مسیر Webhook فعال در نسخه فعلی Next.js:</span>
            </p>
            <p className="font-mono text-sky-300 dir-ltr text-left">
              POST /api/telegram/webhook (Header: X-Telegram-Bot-Api-Secret-Token)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
