'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Gamepad2,
  Globe,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  Sliders,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { initTelegramMiniApp } from '@/lib/telegram-webapp';
import type { PlanetConfig } from './types';

interface AdminUserRow {
  id: number;
  telegram_id: string | null;
  username: string;
  display_name: string;
  phone_verified: number;
  onboarding_completed: number;
  subscription_tier: 'free' | 'plus' | 'vip';
  level: number;
  is_banned: number;
  city: string;
  free_stars: number;
  paid_stars: number;
  last_login_at: string | null;
}

interface AdminGroupRow {
  id: number;
  chat_id: string;
  title: string;
  member_count: number;
  bot_is_admin: number;
  anti_link: number;
  anti_ads: number;
  anti_spam: number;
  anti_flood: number;
  anti_tabchi: number;
  lock_media: number;
}

interface ModLogRow {
  id: number;
  group_id: number;
  command: string;
  target_label: string;
  reason: string;
  actor_label: string;
  created_at: string;
}

interface ActiveRoomRow {
  room_code: string;
  game_type: string;
  is_hangout: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ForcedChannelItem {
  id: string;
  chatId: string;
  title: string;
  inviteUrl: string;
  enabled: boolean;
}

interface DelegatedAdminItem {
  telegramId: string;
  label: string;
  role: 'Admin' | 'Moderator' | 'Support' | 'Content Manager' | 'Game Manager';
  addedAt: string;
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

interface ErrorLogRow {
  id: number;
  source: string;
  message: string;
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

interface SystemStatusInfo {
  nodeEnv: string;
  botUsername: string;
  hasBotToken: boolean;
  hasWebhookSecret: boolean;
  hasSessionSecret: boolean;
  hasAdminTelegramId: boolean;
  previewDisabledInProd: boolean;
}

type AdminTab =
  | 'overview'
  | 'users'
  | 'groups'
  | 'reports'
  | 'bot'
  | 'content'
  | 'system'
  | 'admins';

export default function AdminConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [denied, setDenied] = useState(false);

  const [adminInfo, setAdminInfo] = useState<{
    username: string;
    displayName: string;
    role: string;
    isPrimaryAdmin: boolean;
  } | null>(null);

  const [stats, setStats] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [groups, setGroups] = useState<AdminGroupRow[]>([]);
  const [moderationLogs, setModerationLogs] = useState<ModLogRow[]>([]);
  const [activeRooms, setActiveRooms] = useState<ActiveRoomRow[]>([]);
  const [planets, setPlanets] = useState<PlanetConfig[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [adultVerifications, setAdultVerifications] = useState<AdultVerificationRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogRow[]>([]);
  const [forcedChannels, setForcedChannels] = useState<ForcedChannelItem[]>([]);
  const [delegatedAdmins, setDelegatedAdmins] = useState<DelegatedAdminItem[]>([]);
  const [contentCounts, setContentCounts] = useState({ quizCount: 0, tdCount: 0 });
  const [systemStatus, setSystemStatus] = useState<SystemStatusInfo | null>(null);

  // Bot settings editor
  const [welcomeText, setWelcomeText] = useState('به مدار خوش آمدی.');
  const [requirePhoneContact, setRequirePhoneContact] = useState(true);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // New forced channel form
  const [newChChatId, setNewChChatId] = useState('');
  const [newChTitle, setNewChTitle] = useState('');
  const [newChUrl, setNewChUrl] = useState('https://t.me/');

  // Delegated admin form
  const [newAdminTgId, setNewAdminTgId] = useState('');
  const [newAdminLabel, setNewAdminLabel] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<DelegatedAdminItem['role']>('Moderator');

  const [tab, setTab] = useState<AdminTab>('overview');
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

  const loadAdminData = useCallback(
    async (activeToken: string, queryText: string) => {
      const qs = queryText ? `?q=${encodeURIComponent(queryText)}` : '';
      const res = await fetch(`/api/admin${qs}`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (!res.ok) {
        setDenied(true);
        return false;
      }
      const data = await res.json();
      setDenied(false);
      setAdminInfo(data.admin);
      setStats(data.stats || {});
      setUsers(data.users || []);
      setGroups(data.groups || []);
      setModerationLogs(data.moderationLogs || []);
      setActiveRooms(data.activeEngineRooms || []);
      setPlanets(data.planets || []);
      setReports(data.reports || []);
      setAdultVerifications(data.adultVerifications || []);
      setAuditLogs(data.auditLogs || []);
      setErrorLogs(data.errorLogs || []);
      setForcedChannels(data.forcedChannels || []);
      setDelegatedAdmins(data.delegatedAdmins || []);
      setContentCounts(data.contentCounts || { quizCount: 0, tdCount: 0 });
      setSystemStatus(data.systemStatus || null);
      if (data.botSettings) {
        setWelcomeText(data.botSettings.welcomeText || 'به مدار خوش آمدی.');
        setRequirePhoneContact(data.botSettings.requirePhoneContact !== false);
        setMaintenanceMode(Boolean(data.botSettings.maintenanceMode));
      }
      return true;
    },
    []
  );

  // Authenticate exclusively via Telegram Mini App initData verified server-side
  useEffect(() => {
    let active = true;
    async function bootAdmin() {
      try {
        const tg = initTelegramMiniApp();
        if (!tg.inTelegram || !tg.initData) {
          if (active) {
            setDenied(true);
            setChecking(false);
          }
          return;
        }
        const authRes = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'telegram', initData: tg.initData }),
        });
        const authData = await authRes.json();
        if (!authRes.ok || !authData.token || !authData.isAdmin) {
          if (active) {
            setDenied(true);
            setChecking(false);
          }
          return;
        }
        if (active) {
          setToken(authData.token);
          await loadAdminData(authData.token, '');
          setChecking(false);
        }
      } catch {
        if (active) {
          setDenied(true);
          setChecking(false);
        }
      }
    }
    void bootAdmin();
    return () => {
      active = false;
    };
  }, [loadAdminData]);

  useEffect(() => {
    if (!token || denied) return;
    const t = setTimeout(() => {
      void loadAdminData(token, searchQ);
    }, 220);
    return () => clearTimeout(t);
  }, [token, denied, searchQ, loadAdminData]);

  async function runAdminMutation(payload: Record<string, unknown>) {
    if (!token) return;
    setNotice(null);
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setNotice(data.message || data.error || 'عملیات انجام شد.');
    if (res.ok) {
      await loadAdminData(token, searchQ);
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

  function handleAddChannel() {
    if (!newChChatId.trim() || !newChTitle.trim() || !/^https:\/\/t\.me\//i.test(newChUrl.trim())) {
      setNotice('شناسه کانال، عنوان و لینک معتبر https://t.me/ را وارد کنید.');
      return;
    }
    const next: ForcedChannelItem[] = [
      ...forcedChannels,
      {
        id: `ch_${Date.now().toString(36)}`,
        chatId: newChChatId.trim(),
        title: newChTitle.trim(),
        inviteUrl: newChUrl.trim(),
        enabled: true,
      },
    ];
    setForcedChannels(next);
    setNewChChatId('');
    setNewChTitle('');
    setNewChUrl('https://t.me/');
    void runAdminMutation({ action: 'update_forced_channels', channels: next });
  }

  if (checking) {
    return (
      <div className="min-h-[100dvh] bg-[#0e1621] text-slate-300 flex items-center justify-center p-4 text-sm">
        در حال بررسی دسترسی...
      </div>
    );
  }

  // Neutral access denied screen — no password form, no technical leaks
  if (denied || !adminInfo) {
    return (
      <div className="min-h-[100dvh] bg-[#0e1621] text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm madar-glass rounded-3xl p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-[#23303e] mx-auto flex items-center justify-center text-slate-400">
            <Lock className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-white">دسترسی غیرمجاز</h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              این بخش فقط برای مدیریت احراز هویت‌شده از طریق تلگرام قابل مشاهده است.
            </p>
          </div>
          <Link
            href="/"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8] px-4 py-3 text-xs font-bold text-slate-950 min-h-[44px]"
          >
            <ArrowRight className="w-4 h-4" />
            <span>بازگشت به مدار</span>
          </Link>
        </div>
      </div>
    );
  }

  const tabs: { id: AdminTab; label: string }[] = [
    { id: 'overview', label: 'آمار' },
    { id: 'users', label: 'کاربران' },
    { id: 'groups', label: 'گروه‌ها' },
    { id: 'reports', label: 'گزارش‌ها و +۱۸' },
    { id: 'bot', label: 'ربات و عضویت اجباری' },
    { id: 'content', label: 'محتوا و بازی‌ها' },
    { id: 'system', label: 'خطاها و سیستم' },
    ...(adminInfo.isPrimaryAdmin ? [{ id: 'admins' as const, label: 'دسترسی ادمین‌ها' }] : []),
  ];

  return (
    <div className="min-h-[100dvh] bg-[#0e1621] text-slate-100 pb-10">
      <header className="sticky top-0 z-30 border-b border-[#23303e] bg-[#17212b]/95 px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-[#38bdf8]">
              پنل مدیریت اختصاصی مدار · {adminInfo.displayName} ({adminInfo.role})
            </p>
            <h1 className="text-base sm:text-lg font-bold text-white truncate">مرکز مدیریت و نظارت</h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => token && void loadAdminData(token, searchQ)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs text-slate-200 hover:border-[#38bdf8]/50 min-h-[40px]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>بروزرسانی</span>
            </button>

            <Link
              href="/?asUser=1"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#38bdf8] px-3.5 py-2 text-xs font-bold text-slate-950 hover:brightness-110 min-h-[40px]"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>بازگشت به محیط عادی مدار</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3.5 sm:px-5 pt-5 space-y-5">
        {/* Scrollable Tab Bar */}
        <div className="madar-scroll-x">
          <div className="inline-flex items-center gap-1 p-1 bg-[#17212b] border border-[#23303e] rounded-xl min-w-full sm:min-w-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 min-h-[40px] transition-colors ${
                  tab === t.id ? 'bg-[#38bdf8] text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {notice && (
          <div className="rounded-xl border border-sky-400/40 bg-sky-400/10 px-4 py-3 text-xs sm:text-sm text-sky-100">
            {notice}
          </div>
        )}

        {/* TAB 1: OVERVIEW STATS */}
        {tab === 'overview' && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
            {[
              { label: 'کل کاربران', val: stats.totalUsers ?? 0 },
              { label: 'دارای شماره تأییدشده', val: stats.verifiedUsers ?? 0 },
              { label: 'مچینگ‌های فعال ونوس', val: stats.activeMatches ?? 0 },
              { label: 'کل بازی‌های ثبت‌شده', val: stats.totalGames ?? 0 },
              { label: 'اتاق‌های فعال بازی', val: stats.activeRooms ?? 0 },
              { label: 'گروه‌های متصل زحل', val: stats.totalGroups ?? 0 },
              { label: 'نجواهای ناشناس', val: stats.totalWhispers ?? 0 },
              { label: 'گزارش‌های باز', val: stats.openReports ?? 0 },
              { label: 'خطاهای ثبت‌شده', val: stats.errorCount ?? 0 },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-1">
                <p className="text-xs text-slate-400">{kpi.label}</p>
                <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white">{kpi.val}</p>
              </div>
            ))}
          </div>
        )}

        {/* TAB 2: USERS */}
        {tab === 'users' && (
          <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-4">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="جست‌وجوی نام، نام کاربری یا شناسه تلگرام..."
                className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] pr-9 pl-3 py-2.5 text-sm text-white"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-[#23303e] text-slate-400">
                  <tr>
                    <th className="py-2.5 px-3">کاربر</th>
                    <th className="py-2.5 px-3">وضعیت</th>
                    <th className="py-2.5 px-3">ستاره</th>
                    <th className="py-2.5 px-3">اشتراک</th>
                    <th className="py-2.5 px-3">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#23303e]">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="py-3 px-3">
                        <p className="font-semibold text-white">{u.display_name}</p>
                        <p className="text-slate-400">
                          @{u.username} {u.telegram_id ? `· TG:${u.telegram_id}` : ''}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {u.phone_verified ? 'شماره تأییدشده' : 'بدون شماره'}
                        {u.is_banned ? ' · مسدود' : ''}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-amber-300">
                        {u.free_stars + u.paid_stars}
                      </td>
                      <td className="py-3 px-3">
                        <select
                          value={u.subscription_tier}
                          onChange={(e) =>
                            void runAdminMutation({ action: 'update_tier', userId: u.id, tier: e.target.value })
                          }
                          className="rounded-lg border border-[#23303e] bg-[#0e1621] px-2 py-1 text-xs text-white"
                        >
                          <option value="free">رایگان</option>
                          <option value="plus">پلاس</option>
                          <option value="vip">VIP</option>
                        </select>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              void runAdminMutation({
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
                              void runAdminMutation({
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

        {/* TAB 3: GROUPS */}
        {tab === 'groups' && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-4">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-[#38bdf8]" />
                <span>گروه‌های متصل تلگرام ({groups.length})</span>
              </h2>
              {groups.length === 0 ? (
                <p className="text-xs text-slate-400">هنوز گروهی ثبت نشده است.</p>
              ) : (
                <div className="space-y-3">
                  {groups.map((g) => (
                    <div
                      key={g.id}
                      className="rounded-xl border border-[#23303e] bg-[#0e1621] p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-white">{g.title}</span>
                        <span className="font-mono text-slate-400">
                          {g.chat_id} · {g.member_count} عضو
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        {(
                          [
                            ['anti_link', 'ضدلینک'],
                            ['anti_ads', 'ضدتبلیغ'],
                            ['anti_spam', 'ضداسپم'],
                            ['anti_flood', 'ضدفیلود'],
                            ['anti_tabchi', 'ضدتبچی'],
                            ['lock_media', 'قفل رسانه'],
                          ] as const
                        ).map(([field, label]) => {
                          const enabled = Boolean(g[field]);
                          return (
                            <button
                              key={field}
                              type="button"
                              onClick={() =>
                                void runAdminMutation({
                                  action: 'toggle_group_rule',
                                  groupId: g.id,
                                  field,
                                  enabled: !enabled,
                                })
                              }
                              className={`rounded-lg border px-2.5 py-1.5 transition-colors ${
                                enabled
                                  ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
                                  : 'border-[#23303e] bg-[#17212b] text-slate-400'
                              }`}
                            >
                              {label}: {enabled ? 'فعال' : 'خاموش'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-3">
              <h2 className="text-sm font-bold text-white">گزارش‌های اخیر مدیریت گروه ({moderationLogs.length})</h2>
              <div className="divide-y divide-[#23303e] max-h-64 overflow-y-auto text-xs">
                {moderationLogs.map((m) => (
                  <div key={m.id} className="py-2 flex items-center justify-between gap-2">
                    <span className="text-slate-200">
                      <strong className="text-sky-300">{m.command}</strong> · {m.target_label} ({m.reason})
                    </span>
                    <span className="font-mono text-[10px] text-slate-500 shrink-0">{m.created_at.slice(0, 16)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: REPORTS & 18+ */}
        {tab === 'reports' && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-rose-500/30 bg-[#17212b] p-4 sm:p-5 space-y-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-rose-400" />
                <span>درخواست‌های احراز سن +۱۸ ({adultVerifications.length})</span>
              </h2>
              {adultVerifications.length === 0 ? (
                <p className="text-xs text-slate-400">درخواستی ثبت نشده است.</p>
              ) : (
                <div className="divide-y divide-[#23303e]">
                  {adultVerifications.map((av) => (
                    <div key={av.user_id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5">
                        <p className="text-white font-semibold">
                          {av.display_name} (@{av.username}) · تولد: {av.birth_date || '—'} · شماره:{' '}
                          {av.phone_verified ? 'تأییدشده' : 'تأییدنشده'}
                        </p>
                        <p className="text-slate-400">{av.verification_note}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-amber-300">{av.status}</span>
                        <button
                          type="button"
                          onClick={() =>
                            void runAdminMutation({
                              action: 'review_adult_verification',
                              userId: av.user_id,
                              decision: 'verified',
                            })
                          }
                          className="rounded-lg border border-emerald-400/40 px-2.5 py-1 text-emerald-200 hover:bg-emerald-400/15"
                        >
                          تأیید
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runAdminMutation({
                              action: 'review_adult_verification',
                              userId: av.user_id,
                              decision: 'rejected',
                            })
                          }
                          className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-rose-200 hover:bg-rose-500/15"
                        >
                          رد
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-rose-400" />
                <span>گزارش‌های تخلف ({reports.length})</span>
              </h2>
              {reports.length === 0 ? (
                <p className="text-xs text-slate-400">گزارش تخلفی ثبت نشده است.</p>
              ) : (
                <div className="divide-y divide-[#23303e]">
                  {reports.map((r) => (
                    <div key={r.id} className="py-3 text-xs space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-white font-semibold">
                          {r.target_type} #{r.target_id}
                        </span>
                        <span className="text-amber-300">{r.status}</span>
                      </div>
                      <p className="text-slate-300">{r.reason}</p>
                      {r.status === 'open' && (
                        <div className="flex gap-3 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              void runAdminMutation({ action: 'resolve_report', reportId: r.id, status: 'resolved' })
                            }
                            className="text-emerald-300 underline"
                          >
                            رسیدگی و بستن
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void runAdminMutation({ action: 'resolve_report', reportId: r.id, status: 'dismissed' })
                            }
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
          </div>
        )}

        {/* TAB 5: BOT SETTINGS & FORCED CHANNELS */}
        {tab === 'bot' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-4">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Bot className="w-4 h-4 text-[#38bdf8]" />
                <span>تنظیمات ربات (@{systemStatus?.botUsername || 'm4d4rbot'})</span>
              </h2>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 block">متن خوش‌آمدگویی /start</label>
                <textarea
                  rows={3}
                  value={welcomeText}
                  onChange={(e) => setWelcomeText(e.target.value)}
                  className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] p-3 text-sm text-white"
                />
              </div>
              <label className="flex items-center justify-between rounded-xl border border-[#23303e] bg-[#0e1621] px-3.5 py-3 text-xs cursor-pointer">
                <span>درخواست یک‌باره اشتراک‌گذاری شماره تلگرام پس از عضویت کانال‌ها</span>
                <input
                  type="checkbox"
                  checked={requirePhoneContact}
                  onChange={(e) => setRequirePhoneContact(e.target.checked)}
                  className="accent-[#38bdf8] w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-[#23303e] bg-[#0e1621] px-3.5 py-3 text-xs cursor-pointer">
                <span>حالت نگهداری موقت (Maintenance Mode)</span>
                <input
                  type="checkbox"
                  checked={maintenanceMode}
                  onChange={(e) => setMaintenanceMode(e.target.checked)}
                  className="accent-amber-400 w-4 h-4"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  void runAdminMutation({
                    action: 'update_bot_settings',
                    welcomeText,
                    requirePhoneContact,
                    maintenanceMode,
                  })
                }
                className="rounded-xl bg-[#38bdf8] px-5 py-2.5 text-xs font-bold text-slate-950 min-h-[42px]"
              >
                ذخیره تنظیمات ربات
              </button>
            </div>

            <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-4">
              <h2 className="text-sm font-bold text-white">تنظیمات عضویت اجباری کانال‌ها</h2>
              <div className="space-y-2">
                {forcedChannels.length === 0 ? (
                  <p className="text-xs text-slate-400">کانال اجباری ثبت نشده است.</p>
                ) : (
                  forcedChannels.map((ch, idx) => (
                    <div
                      key={ch.id}
                      className="rounded-xl border border-[#23303e] bg-[#0e1621] p-3 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{ch.title}</p>
                        <p className="font-mono text-[11px] text-slate-400 truncate">
                          {ch.chatId} · {ch.inviteUrl}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            const next = forcedChannels.map((item, i) =>
                              i === idx ? { ...item, enabled: !item.enabled } : item
                            );
                            setForcedChannels(next);
                            void runAdminMutation({ action: 'update_forced_channels', channels: next });
                          }}
                          className={`rounded-lg px-2.5 py-1 border ${
                            ch.enabled
                              ? 'border-emerald-400/40 text-emerald-300'
                              : 'border-slate-700 text-slate-400'
                          }`}
                        >
                          {ch.enabled ? 'فعال' : 'غیرفعال'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const next = forcedChannels.filter((_, i) => i !== idx);
                            setForcedChannels(next);
                            void runAdminMutation({ action: 'update_forced_channels', channels: next });
                          }}
                          className="p-1.5 text-rose-300 hover:bg-rose-500/15 rounded-lg"
                          aria-label="حذف کانال"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-3 border-t border-[#23303e] space-y-2.5">
                <p className="text-xs font-semibold text-slate-200">افزودن کانال اجباری جدید</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newChChatId}
                    onChange={(e) => setNewChChatId(e.target.value)}
                    placeholder="@channel_username یا -100..."
                    className="rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs text-white dir-ltr text-left"
                  />
                  <input
                    type="text"
                    value={newChTitle}
                    onChange={(e) => setNewChTitle(e.target.value)}
                    placeholder="عنوان کانال (مثلاً کانال رسمی مدار)"
                    className="rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs text-white"
                  />
                </div>
                <input
                  type="url"
                  value={newChUrl}
                  onChange={(e) => setNewChUrl(e.target.value)}
                  placeholder="https://t.me/channel_username"
                  className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs text-white dir-ltr text-left"
                />
                <button
                  type="button"
                  onClick={handleAddChannel}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-bold text-slate-950 min-h-[40px]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>افزودن و ذخیره کانال</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: CONTENT & GAMES */}
        {tab === 'content' && (
          <div className="space-y-5">
            {/* Active Game Rooms */}
            <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4 text-[#38bdf8]" />
                  <span>اتاق‌های بازی اخیر ({activeRooms.length})</span>
                </h2>
                <button
                  type="button"
                  onClick={() => void runAdminMutation({ action: 'cleanup_stale_rooms' })}
                  className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/20"
                >
                  پاک‌سازی اتاق‌های قدیمی
                </button>
              </div>
              <div className="divide-y divide-[#23303e] max-h-48 overflow-y-auto text-xs">
                {activeRooms.map((rm) => (
                  <div key={rm.room_code} className="py-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-white">
                      {rm.room_code} · {rm.game_type} {rm.is_hangout ? '(دورهمی)' : ''}
                    </span>
                    <span className="text-slate-400">{rm.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Planets editor */}
            <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold text-white">
                  <Globe className="w-4 h-4 text-sky-400" />
                  <span>سیارات صفحه اصلی</span>
                </span>
                <button
                  type="button"
                  onClick={() => void runAdminMutation({ action: 'update_planets', planets })}
                  className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-slate-950"
                >
                  ذخیره سیارات
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {planets.map((p, idx) => (
                  <div key={p.id} className="rounded-xl border border-[#23303e] bg-[#0e1621] p-3 grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={p.name}
                      onChange={(e) => {
                        const next = [...planets];
                        next[idx] = { ...p, name: e.target.value };
                        setPlanets(next);
                      }}
                      className="rounded-lg border border-[#23303e] bg-[#17212b] px-2.5 py-1.5 text-xs text-white"
                    />
                    <input
                      type="text"
                      value={p.subtitle}
                      onChange={(e) => {
                        const next = [...planets];
                        next[idx] = { ...p, subtitle: e.target.value };
                        setPlanets(next);
                      }}
                      className="rounded-lg border border-[#23303e] bg-[#17212b] px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Quiz & Truth-Dare */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-bold text-white">
                    <Upload className="w-4 h-4 text-amber-400" />
                    <span>ورود گروهی کوییز (JSON)</span>
                  </span>
                  <span className="text-xs font-mono text-slate-400">{contentCounts.quizCount} سؤال</span>
                </div>
                <textarea
                  rows={7}
                  value={bulkQuizJson}
                  onChange={(e) => setBulkQuizJson(e.target.value)}
                  className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] p-3 text-xs font-mono text-slate-100 dir-ltr text-left"
                />
                <button
                  type="button"
                  onClick={() => void handleBulkQuizImport()}
                  className="rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950"
                >
                  افزودن به بانک کوییز
                </button>
              </div>

              <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-bold text-white">
                    <Plus className="w-4 h-4 text-orange-400" />
                    <span>افزودن جرئت و حقیقت</span>
                  </span>
                  <span className="text-xs font-mono text-slate-400">{contentCounts.tdCount} کارت</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={tdMode}
                    onChange={(e) => setTdMode(e.target.value as 'truth' | 'dare')}
                    className="rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs text-white"
                  >
                    <option value="truth">حقیقت</option>
                    <option value="dare">جرئت</option>
                  </select>
                  <input
                    type="text"
                    value={tdCat}
                    onChange={(e) => setTdCat(e.target.value)}
                    placeholder="دسته‌بندی"
                    className="rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs text-white"
                  />
                </div>
                <textarea
                  rows={3}
                  value={tdText}
                  onChange={(e) => setTdText(e.target.value)}
                  placeholder="متن سؤال یا چالش..."
                  className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] p-3 text-sm text-white"
                />
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tdAdult}
                    onChange={(e) => setTdAdult(e.target.checked)}
                    className="accent-rose-400"
                  />
                  <span>مخصوص بزرگسالان ۱۸+</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (!tdText.trim()) return;
                    void runAdminMutation({
                      action: 'add_td_prompt',
                      mode: tdMode,
                      category: tdCat,
                      text: tdText,
                      isAdult: tdAdult,
                    });
                    setTdText('');
                  }}
                  className="block rounded-xl bg-orange-400 px-5 py-2.5 text-xs font-bold text-slate-950"
                >
                  ذخیره کارت
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 7: ERROR LOGS, AUDIT LOGS & SYSTEM STATUS */}
        {tab === 'system' && (
          <div className="space-y-5">
            {systemStatus && (
              <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-3">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Server className="w-4 h-4 text-[#38bdf8]" />
                  <span>وضعیت سیستم</span>
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
                  {[
                    { label: 'محیط اجرا', val: systemStatus.nodeEnv, ok: true },
                    { label: 'شناسه ربات', val: `@${systemStatus.botUsername}`, ok: true },
                    { label: 'توکن ربات تلگرام', val: systemStatus.hasBotToken ? 'تنظیم‌شده' : 'تنظیم‌نشده', ok: systemStatus.hasBotToken },
                    { label: 'کلید Webhook', val: systemStatus.hasWebhookSecret ? 'تنظیم‌شده' : 'تنظیم‌نشده', ok: systemStatus.hasWebhookSecret },
                    { label: 'کلید SESSION_SECRET', val: systemStatus.hasSessionSecret ? 'تنظیم‌شده' : 'تنظیم‌نشده', ok: systemStatus.hasSessionSecret },
                    { label: 'ADMIN_TELEGRAM_ID', val: systemStatus.hasAdminTelegramId ? 'تنظیم‌شده' : 'تنظیم‌نشده', ok: systemStatus.hasAdminTelegramId },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-[#23303e] bg-[#0e1621] p-3">
                      <p className="text-slate-400">{item.label}</p>
                      <p className={`font-semibold mt-1 ${item.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {item.val}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>گزارش خطاها ({errorLogs.length})</span>
                  </h2>
                  {errorLogs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void runAdminMutation({ action: 'clear_error_logs' })}
                      className="text-xs text-rose-300 hover:underline"
                    >
                      پاک‌سازی خطاها
                    </button>
                  )}
                </div>
                {errorLogs.length === 0 ? (
                  <p className="text-xs text-slate-400">خطایی ثبت نشده است.</p>
                ) : (
                  <div className="divide-y divide-[#23303e] max-h-72 overflow-y-auto text-xs">
                    {errorLogs.map((err) => (
                      <div key={err.id} className="py-2.5 space-y-0.5">
                        <div className="flex justify-between">
                          <span className="font-mono text-amber-300">{err.source}</span>
                          <span className="font-mono text-[10px] text-slate-500">{err.created_at.slice(0, 16)}</span>
                        </div>
                        <p className="text-slate-200">{err.message}</p>
                        {err.details && <p className="text-[11px] text-slate-400 break-all">{err.details}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-3">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  <span>لاگ عملیات مدیریت ({auditLogs.length})</span>
                </h2>
                <div className="divide-y divide-[#23303e] max-h-72 overflow-y-auto text-xs">
                  {auditLogs.map((a) => (
                    <div key={a.id} className="py-2.5 space-y-0.5">
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

        {/* TAB 8: DELEGATED ADMIN MANAGEMENT (PRIMARY ADMIN ONLY) */}
        {tab === 'admins' && adminInfo.isPrimaryAdmin && (
          <div className="rounded-2xl border border-[#23303e] bg-[#17212b] p-4 sm:p-5 space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-[#38bdf8]" />
              <span>مدیریت دسترسی ادمین‌های کمکی (فقط مدیر اصلی)</span>
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              مدیر اصلی از طریق متغیر محیطی <code className="font-mono text-sky-300">ADMIN_TELEGRAM_ID</code> تعیین می‌شود. در این بخش می‌توانید به شناسه‌های تلگرام دیگر نقش‌های مدیریتی بدهید یا دسترسی آن‌ها را حذف کنید.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <input
                type="text"
                value={newAdminTgId}
                onChange={(e) => setNewAdminTgId(e.target.value)}
                placeholder="شناسه عددی تلگرام"
                className="rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs text-white font-mono dir-ltr text-left"
              />
              <input
                type="text"
                value={newAdminLabel}
                onChange={(e) => setNewAdminLabel(e.target.value)}
                placeholder="نام یا عنوان مدیر"
                className="rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs text-white"
              />
              <select
                value={newAdminRole}
                onChange={(e) => setNewAdminRole(e.target.value as DelegatedAdminItem['role'])}
                className="rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs text-white"
              >
                <option value="Admin">Admin</option>
                <option value="Moderator">Moderator</option>
                <option value="Support">Support</option>
                <option value="Content Manager">Content Manager</option>
                <option value="Game Manager">Game Manager</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!newAdminTgId.trim() || !newAdminLabel.trim()) return;
                  void runAdminMutation({
                    action: 'add_delegated_admin',
                    telegramId: newAdminTgId.trim(),
                    label: newAdminLabel.trim(),
                    role: newAdminRole,
                  });
                  setNewAdminTgId('');
                  setNewAdminLabel('');
                }}
                className="rounded-xl bg-[#38bdf8] px-4 py-2 text-xs font-bold text-slate-950 min-h-[40px]"
              >
                افزودن مدیر
              </button>
            </div>

            <div className="divide-y divide-[#23303e] text-xs">
              {delegatedAdmins.length === 0 ? (
                <p className="text-slate-400 py-3">هنوز ادمین کمکی ثبت نشده است.</p>
              ) : (
                delegatedAdmins.map((ad) => (
                  <div key={ad.telegramId} className="py-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-white">
                        {ad.label} · <span className="text-sky-300">{ad.role}</span>
                      </p>
                      <p className="font-mono text-[11px] text-slate-400">TG: {ad.telegramId}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void runAdminMutation({
                          action: 'remove_delegated_admin',
                          telegramId: ad.telegramId,
                        })
                      }
                      className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-rose-300 hover:bg-rose-500/15"
                    >
                      حذف دسترسی
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
