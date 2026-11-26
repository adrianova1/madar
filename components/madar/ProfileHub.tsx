'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Award,
  Brain,
  CheckCircle2,
  LogOut,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import type { PersonalityQuestionDef } from '@/lib/personality-data';
import type { MadarUser, UserSessionItem } from './types';

interface ProfileHubProps {
  token: string | null;
  user: MadarUser | null;
  sessions: UserSessionItem[];
  currentSessionId: string | null;
  onRefreshUser: () => Promise<void>;
  onLogout: (scope: 'current' | 'others' | 'delete_account') => Promise<void>;
}

export default function ProfileHub({
  token,
  user,
  sessions,
  currentSessionId,
  onRefreshUser,
  onLogout,
}: ProfileHubProps) {
  const [profileTab, setProfileTab] = useState<'info' | 'personality' | 'security'>('info');
  const [notice, setNotice] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Editable Profile State
  const [syncedUserId, setSyncedUserId] = useState<number | null>(null);
  const [editDisplay, setEditDisplay] = useState(user?.display_name ?? '');
  const [editCity, setEditCity] = useState(user?.city || 'تهران');
  const [editGender, setEditGender] = useState(user?.gender || 'unspecified');
  const [editBirth, setEditBirth] = useState(user?.birth_date || '1998-01-01');
  const [editCultural, setEditCultural] = useState(user?.cultural_bg || '');
  const [editBio, setEditBio] = useState(user?.bio || '');
  const [editInterests, setEditInterests] = useState((user?.interests || []).join('، '));
  const [editGoal, setEditGoal] = useState(user?.goal || '');
  const [hideCity, setHideCity] = useState(Boolean(user?.hide_city));
  const [hideOnline, setHideOnline] = useState(Boolean(user?.hide_online));
  const [allowWhispers, setAllowWhispers] = useState(user ? Boolean(user.allow_whispers) : true);

  // Separated Independent Venus Dating Profile State
  const [dpBio, setDpBio] = useState(user?.datingProfile?.datingBio || '');
  const [dpLookingFor, setDpLookingFor] = useState(
    user?.datingProfile?.lookingFor || 'آشنایی جدی و گفت‌وگوی عمیق'
  );
  const [dpGenderPref, setDpGenderPref] = useState<'all' | 'زن' | 'مرد'>(
    (user?.datingProfile?.genderPref as 'all' | 'زن' | 'مرد') || 'all'
  );
  const [dpShowCity, setDpShowCity] = useState(user?.datingProfile?.showCity ?? true);

  // Strict Multi-Layer 18+ Verification & Consent State
  const [adultConsentChecked, setAdultConsentChecked] = useState(false);
  const [adultVerificationNote, setAdultVerificationNote] = useState('');

  if (user && syncedUserId !== user.id) {
    setSyncedUserId(user.id);
    setAvatarFailed(false);
    setEditDisplay(user.display_name);
    setEditCity(user.city || 'تهران');
    setEditGender(user.gender || 'unspecified');
    setEditBirth(user.birth_date || '1998-01-01');
    setEditCultural(user.cultural_bg || '');
    setEditBio(user.bio || '');
    setEditInterests((user.interests || []).join('، '));
    setEditGoal(user.goal || '');
    setHideCity(Boolean(user.hide_city));
    setHideOnline(Boolean(user.hide_online));
    setAllowWhispers(Boolean(user.allow_whispers));
    setDpBio(user.datingProfile?.datingBio || '');
    setDpLookingFor(user.datingProfile?.lookingFor || 'آشنایی جدی و گفت‌وگوی عمیق');
    setDpGenderPref((user.datingProfile?.genderPref as 'all' | 'زن' | 'مرد') || 'all');
    setDpShowCity(user.datingProfile?.showCity ?? true);
  }

  // Personality Test State
  const [questions, setQuestions] = useState<PersonalityQuestionDef[]>([]);
  const [answers, setAnswers] = useState<
    Record<string, { value: number; label: string; includeInMatching: boolean }>
  >({});
  const [completionPercent, setCompletionPercent] = useState(0);
  const [disclaimer, setDisclaimer] = useState('');

  const loadPersonality = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/personality', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setQuestions(data.questions || []);
      setAnswers(data.answers || {});
      setCompletionPercent(data.completionPercent || 0);
      setDisclaimer(data.disclaimer || '');
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await loadPersonality();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadPersonality]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSavingProfile(true);
    try {
      const interestsArr = editInterests
        .split(/[،,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          displayName: editDisplay,
          city: editCity,
          gender: editGender,
          birthDate: editBirth,
          culturalBg: editCultural,
          bio: editBio,
          interests: interestsArr,
          goal: editGoal,
          hideCity,
          hideOnline,
          allowWhispers,
        }),
      });
      const data = await res.json();
      setNotice(data.message || data.error);
      if (res.ok) await onRefreshUser();
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleDatingProfileAction(action: 'save' | 'pause' | 'resume' | 'delete') {
    if (!token) return;
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(
        action === 'save'
          ? {
              datingProfileAction: 'save',
              datingBio: dpBio,
              lookingFor: dpLookingFor,
              datingGenderPref: dpGenderPref,
              datingShowCity: dpShowCity,
            }
          : { datingProfileAction: action }
      ),
    });
    const data = await res.json();
    setNotice(data.message || data.error);
    if (res.ok) await onRefreshUser();
  }

  async function submitAdultVerificationRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const res = await fetch('/api/adult-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        consentAccepted: adultConsentChecked,
        verificationNote: adultVerificationNote,
      }),
    });
    const data = await res.json();
    setNotice(data.message || data.error);
    if (res.ok) {
      setAdultVerificationNote('');
      await onRefreshUser();
    }
  }

  async function revokeAdultAccess() {
    if (!token) return;
    const res = await fetch('/api/adult-access', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setNotice(data.message || data.error);
    if (res.ok) await onRefreshUser();
  }

  async function savePersonalityAnswer(qId: string, val: number, includeInMatching: boolean) {
    if (!token) return;
    const res = await fetch('/api/personality', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ questionId: qId, answerValue: val, includeInMatching }),
    });
    const data = await res.json();
    if (res.ok) {
      await loadPersonality();
      if (data.rewarded) {
        setNotice('تبریک! با تکمیل هر ۱۲ بُعد آزمون، +۴۰ ستاره پاداش گرفتی.');
        await onRefreshUser();
      }
    }
  }

  // Shared mobile-safe input class: text-base on mobile prevents iOS/Telegram WebView zoom on focus
  const inputCls =
    'w-full min-w-0 max-w-full rounded-xl border border-[#23303E] bg-[#0E1621] px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-slate-500 focus:border-[#38BDF8] focus:outline-none transition-colors';

  if (!token || !user) {
    return (
      <div className="w-full max-w-md mx-auto madar-glass rounded-3xl p-6 sm:p-8 space-y-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-[#38bdf8]/15 border border-[#38bdf8]/35 mx-auto flex items-center justify-center">
          <Send className="w-5 h-5 text-[#38bdf8]" />
        </div>
        <h1 className="text-lg font-bold text-white">ورود از طریق تلگرام</h1>
        <p className="text-xs text-slate-400 leading-relaxed">
          حساب کاربری مدار به صورت مستقیم از طریق ربات تلگرام متصل می‌شود.
        </p>
      </div>
    );
  }

  const showTelegramPhoto = Boolean(user.telegram_photo_url) && !avatarFailed;
  const telegramFullName = [user.telegram_first_name, user.telegram_last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return (
    <div className="w-full max-w-full min-w-0 space-y-5 pb-6 overflow-x-clip">
      {/* Cosmic Identity & Telegram Synced Profile Header */}
      <section className="madar-glass rounded-3xl p-4 sm:p-6 space-y-5 overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-lg sm:text-xl font-bold text-white shrink-0 overflow-hidden ${
                user.equipped_frame === 'frame_gold_orbit'
                  ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-[#0a1026]'
                  : user.equipped_frame === 'frame_neptune_halo'
                    ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-[#0a1026]'
                    : 'border border-white/15'
              }`}
              style={{ backgroundColor: user.avatar_color }}
            >
              {showTelegramPhoto ? (
                <Image
                  src={user.telegram_photo_url!}
                  alt={user.display_name}
                  width={64}
                  height={64}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                user.avatar_initials
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-bold text-white truncate">{user.display_name}</h1>
              <p className="text-xs text-slate-300 mt-1 break-words leading-relaxed">
                <span className="font-mono text-cyan-300">
                  @{user.telegram_username || user.username}
                </span>{' '}
                · سطح <span className="font-mono tabular-nums text-amber-300">{user.level}</span> ·{' '}
                {user.age ? `${user.age} ساله` : 'سن ثبت نشده'} ·{' '}
                {user.hide_city ? 'شهر مخفی' : user.city}
                {user.phone_verified ? ' · شماره تأییدشده' : ''}
              </p>
            </div>
          </div>

          <div className="w-full md:w-auto max-w-full madar-scroll-x">
            <div className="inline-flex items-center gap-1 p-1 bg-[#0E1621] border border-[#23303E] rounded-xl min-w-full sm:min-w-0">
              {[
                { id: 'info', label: 'پروفایل و ونوس' },
                { id: 'personality', label: `آزمون شخصیت (${completionPercent}%)` },
                { id: 'security', label: 'حساب و +۱۸' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setProfileTab(t.id as 'info' | 'personality' | 'security')}
                  className={`flex-1 sm:flex-none px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 min-h-[42px] transition-colors ${
                    profileTab === t.id
                      ? 'bg-[#38BDF8] text-[#0E1621]'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Cosmic Identity Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-4 border-t border-[#23303E]">
          <div className="rounded-xl bg-[#0E1621] border border-[#23303E] p-3 min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
              <span className="truncate">ستاره شخصی</span>
            </p>
            <p className="text-xs sm:text-sm font-bold text-white mt-1 truncate">
              {user.planetEvolution?.title || 'زمینِ نوبنیاد'}
            </p>
          </div>
          <div className="rounded-xl bg-[#0E1621] border border-[#23303E] p-3 min-w-0">
            <p className="text-[11px] text-slate-400">تجربه و سطح</p>
            <p className="text-xs sm:text-sm font-mono tabular-nums font-bold text-amber-300 mt-1">
              LVL {user.level} · {user.xp} XP
            </p>
          </div>
          <div className="rounded-xl bg-[#0E1621] border border-[#23303E] p-3 min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
              <span className="truncate">نشان‌ها و بازی</span>
            </p>
            <p className="text-xs sm:text-sm font-mono tabular-nums font-bold text-slate-100 mt-1">
              {user.earnedBadges?.length || 0} نشان · {user.gamesPlayedCount} بازی
            </p>
          </div>
          <div className="rounded-xl bg-[#0E1621] border border-[#23303E] p-3 min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">صورت‌فلکی دوستان</span>
            </p>
            <p className="text-xs sm:text-sm font-mono tabular-nums font-bold text-emerald-300 mt-1">
              {user.constellationFriends?.length || 0} همراه مدار
            </p>
          </div>
        </div>
      </section>

      {notice && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs sm:text-sm text-amber-100 leading-relaxed">
          {notice}
        </div>
      )}

      {/* TAB 1: SEPARATED SOCIAL PROFILE & INDEPENDENT OPTIONAL DATING PROFILE */}
      {profileTab === 'info' && (
        <div className="space-y-6 min-w-0">
          {/* Read-only Telegram synced identity summary */}
          <div className="rounded-2xl border border-[#23303E] bg-[#17212B]/80 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5 min-w-0">
              <p className="text-slate-400">اطلاعات همگام‌شده از تلگرام</p>
              <p className="text-slate-100 font-medium truncate">
                {telegramFullName || user.display_name}
                {user.telegram_username ? ` (@${user.telegram_username})` : ''}
                {user.telegram_language_code ? ` · زبان: ${user.telegram_language_code}` : ''}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-emerald-300 font-semibold shrink-0">
              <CheckCircle2 className="w-4 h-4" />
              <span>متصل به تلگرام</span>
            </span>
          </div>

          <form onSubmit={saveProfile} className="madar-glass rounded-2xl p-4 sm:p-6 space-y-5 min-w-0">
            <div className="pb-3 border-b border-indigo-500/20">
              <p className="text-xs text-cyan-300">بخش ۱ · پروفایل اختصاصی شما در بازی‌ها، نجوا و منظومه</p>
              <h2 className="text-base sm:text-lg font-bold text-white mt-0.5">تکمیل و ویرایش پروفایل اجتماعی</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <label className="text-xs text-slate-300 block">نام نمایشی</label>
                <input
                  type="text"
                  value={editDisplay}
                  onChange={(e) => setEditDisplay(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5 min-w-0">
                <label className="text-xs text-slate-300 block">تاریخ تولد (لایه اول احراز سن)</label>
                <input
                  type="date"
                  value={editBirth}
                  onChange={(e) => setEditBirth(e.target.value)}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div className="space-y-1.5 min-w-0">
                <label className="text-xs text-slate-300 block">جنسیت</label>
                <select
                  value={editGender}
                  onChange={(e) => setEditGender(e.target.value)}
                  className={inputCls}
                >
                  <option value="unspecified">ترجیح می‌دهم نگویم</option>
                  <option value="زن">زن</option>
                  <option value="مرد">مرد</option>
                </select>
              </div>
              <div className="space-y-1.5 min-w-0">
                <label className="text-xs text-slate-300 block">شهر</label>
                <input
                  type="text"
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5 min-w-0">
                <label className="text-xs text-slate-300 block">هدف اجتماعی در مدار</label>
                <input
                  type="text"
                  value={editGoal}
                  onChange={(e) => setEditGoal(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5 min-w-0">
                <label className="text-xs text-slate-300 block">پیشینه فرهنگی (اختیاری)</label>
                <input
                  type="text"
                  value={editCultural}
                  onChange={(e) => setEditCultural(e.target.value)}
                  placeholder="اختیاری"
                  className={inputCls}
                />
              </div>
            </div>

            <div className="space-y-1.5 min-w-0">
              <label className="text-xs text-slate-300 block">علایق و سرگرمی‌ها (جداشده با کاما)</label>
              <input
                type="text"
                value={editInterests}
                onChange={(e) => setEditInterests(e.target.value)}
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <label className="text-xs text-slate-300 block">بیوگرافی اجتماعی (نمایش در بازی‌ها و منظومه)</label>
              <textarea
                rows={3}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                maxLength={260}
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#23303E]">
              {[
                { label: 'مخفی‌کردن شهر من', val: hideCity, set: setHideCity },
                { label: 'مخفی‌کردن وضعیت آنلاین', val: hideOnline, set: setHideOnline },
                { label: 'دریافت نجوای ناشناس نپتون', val: allowWhispers, set: setAllowWhispers },
              ].map((tog) => (
                <label
                  key={tog.label}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[#23303E] bg-[#0E1621] px-3.5 py-3 text-xs text-slate-200 cursor-pointer min-h-[46px]"
                >
                  <span className="leading-snug">{tog.label}</span>
                  <input
                    type="checkbox"
                    checked={tog.val}
                    onChange={(e) => tog.set(e.target.checked)}
                    className="accent-[#38BDF8] w-4 h-4 shrink-0"
                  />
                </label>
              ))}
            </div>

            <div className="sticky bottom-16 md:bottom-3 z-20 -mx-4 sm:mx-0 px-4 sm:px-0 py-2.5 bg-[#17212B]/95 sm:bg-transparent border-t border-[#23303E] sm:border-0 flex justify-end">
              <button
                type="submit"
                disabled={savingProfile}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#38BDF8] px-6 py-3 text-sm font-bold text-[#0E1621] hover:bg-sky-300 disabled:opacity-60 min-h-[48px] shadow-lg shadow-sky-500/15"
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>{savingProfile ? 'در حال ذخیره...' : 'ذخیره پروفایل اجتماعی'}</span>
              </button>
            </div>
          </form>

          {/* SECTION 2: INDEPENDENT OPTIONAL VENUS DATING PROFILE */}
          <div className="madar-glass rounded-2xl border-rose-500/30 p-4 sm:p-6 space-y-5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-indigo-500/20">
              <div className="min-w-0">
                <p className="text-xs text-rose-300">بخش ۲ · کاملاً اختیاری و جدا از حساب بازی و سرگرمی</p>
                <h2 className="text-base sm:text-lg font-bold text-white mt-0.5">پروفایل مستقل آشنایی ونوس</h2>
              </div>
              <span className="text-xs font-semibold text-slate-200">
                وضعیت:{' '}
                <strong className={user.datingProfile?.isActive ? 'text-emerald-300' : 'text-slate-400'}>
                  {user.datingProfile?.isActive
                    ? 'فعال در ونوس'
                    : user.datingProfile?.exists
                      ? 'متوقف‌شده (مخفی)'
                      : 'ساخته‌نشده'}
                </strong>
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              کاربر می‌تواند فقط برای بازی، نجوا و کهکشان شخصی عضو مدار باشد و هرگز پروفایل آشنایی نسازد. در صورت ساخت یا حذف این بخش، هیچ تغییری در پروفایل اجتماعی، ستاره‌ها و بازی‌های شما ایجاد نمی‌شود.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <label className="text-xs text-slate-300 block">هدف اختصاصی در ونوس</label>
                <input
                  type="text"
                  value={dpLookingFor}
                  onChange={(e) => setDpLookingFor(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5 min-w-0">
                <label className="text-xs text-slate-300 block">ترجیح نمایش در ونوس</label>
                <select
                  value={dpGenderPref}
                  onChange={(e) => setDpGenderPref(e.target.value as 'all' | 'زن' | 'مرد')}
                  className={inputCls}
                >
                  <option value="all">همه کاربران هم‌ساز</option>
                  <option value="زن">زن</option>
                  <option value="مرد">مرد</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5 min-w-0">
              <label className="text-xs text-slate-300 block">بیوگرافی اختصاصی ونوس (مستقل از بیوی اجتماعی)</label>
              <textarea
                rows={2}
                value={dpBio}
                onChange={(e) => setDpBio(e.target.value)}
                maxLength={260}
                placeholder="فقط برای کسانی که در بخش آشنایی ونوس هستند نمایش داده می‌شود..."
                className={inputCls}
              />
            </div>

            <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer min-h-[40px]">
              <input
                type="checkbox"
                checked={dpShowCity}
                onChange={(e) => setDpShowCity(e.target.checked)}
                className="accent-rose-400 w-4 h-4 shrink-0"
              />
              <span>نمایش شهر در کارت آشنایی ونوس</span>
            </label>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-indigo-500/20">
              <div className="flex flex-col sm:flex-row gap-2.5 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => handleDatingProfileAction('save')}
                  className="w-full sm:w-auto rounded-xl bg-rose-500 px-5 py-2.5 text-xs font-semibold text-white hover:bg-rose-400 min-h-[46px]"
                >
                  {user.datingProfile?.exists ? 'ذخیره و فعال‌سازی پروفایل ونوس' : 'ساخت پروفایل مستقل ونوس'}
                </button>
                {user.datingProfile?.exists && user.datingProfile.isActive && (
                  <button
                    type="button"
                    onClick={() => handleDatingProfileAction('pause')}
                    className="w-full sm:w-auto rounded-xl border border-slate-700 px-4 py-2.5 text-xs text-slate-200 hover:border-amber-400 min-h-[46px]"
                  >
                    توقف موقت ونوس
                  </button>
                )}
              </div>
              {user.datingProfile?.exists && (
                <button
                  type="button"
                  onClick={() => handleDatingProfileAction('delete')}
                  className="text-xs text-rose-300 hover:text-rose-200 underline underline-offset-4 py-2 text-right sm:text-left"
                >
                  حذف پروفایل آشنایی (حفظ پروفایل اجتماعی)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: 12-DIMENSION PERSONALITY TEST */}
      {profileTab === 'personality' && (
        <div className="madar-glass rounded-2xl p-4 sm:p-6 space-y-6 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-indigo-500/20">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 text-cyan-300">
                <Brain className="w-5 h-5 shrink-0" />
                <h2 className="text-base sm:text-lg font-bold text-white">آزمون ۱۲ بُعدی ترجیحات و سبک ارتباطی</h2>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">{disclaimer}</p>
            </div>
            <div className="text-right sm:text-left shrink-0">
              <p className="text-xs text-slate-400">درصد تکمیل</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-amber-300">{completionPercent}%</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {questions.map((q) => {
              const saved = answers[q.id];
              return (
                <div key={q.id} className="rounded-2xl border border-indigo-500/20 bg-[#050816] p-4 space-y-3 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-amber-300">{q.dimensionTitle}</span>
                    {saved && (
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={saved.includeInMatching}
                          onChange={(e) => savePersonalityAnswer(q.id, saved.value, e.target.checked)}
                          className="accent-cyan-400"
                        />
                        <span>استفاده در مچینگ</span>
                      </label>
                    )}
                  </div>
                  <p className="text-sm text-slate-100 leading-relaxed">{q.prompt}</p>
                  <div className="space-y-2">
                    {q.options.map((opt) => {
                      const active = saved?.value === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => savePersonalityAnswer(q.id, opt.value, saved?.includeInMatching ?? true)}
                          className={`w-full rounded-xl border px-3.5 py-2.5 text-right text-xs transition-colors min-h-[44px] leading-relaxed ${
                            active
                              ? 'border-cyan-400 bg-cyan-400/15 text-cyan-100 font-semibold'
                              : 'border-slate-800 bg-[#0a1026] text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: READ-ONLY TELEGRAM ACCOUNT STATUS, 18+ GATE & SESSIONS (ZERO PASSWORD / ZERO OTP) */}
      {profileTab === 'security' && (
        <div className="space-y-6 min-w-0">
          {/* Dedicated Multi-Layer 18+ Verification & Consent Gate */}
          <section className="madar-glass rounded-2xl border-rose-500/35 p-4 sm:p-6 space-y-5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-indigo-500/20">
              <div className="min-w-0">
                <p className="text-xs text-rose-300">ایزوله‌سازی کامل سن، رضایت، دسترسی و محتوای مجاز</p>
                <h2 className="text-base sm:text-lg font-bold text-white mt-0.5">احراز چندلایه بخش بزرگسالان (+۱۸)</h2>
              </div>
              <span className="text-xs font-semibold text-slate-200">
                وضعیت:{' '}
                <strong className={user.isAdultVerified ? 'text-emerald-300' : 'text-amber-300'}>
                  {user.isAdultVerified
                    ? 'تأییدشده و باز'
                    : user.adultVerification?.status === 'pending_review'
                      ? 'در صف بررسی مدیریت'
                      : 'قفل (احراز کامل نشده)'}
                </strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl border border-indigo-500/20 bg-[#050816] p-3.5 space-y-1">
                <p className="text-slate-400">لایه ۱ · شرط سنی</p>
                <p className={user.adultVerification?.birthDateOver18 ? 'text-emerald-300 font-semibold' : 'text-rose-300 font-semibold'}>
                  {user.adultVerification?.birthDateOver18 ? 'تاریخ تولد بالای ۱۸ سال ثبت شده' : 'تاریخ تولد بالای ۱۸ سال نیست'}
                </p>
              </div>
              <div className="rounded-xl border border-indigo-500/20 bg-[#050816] p-3.5 space-y-1">
                <p className="text-slate-400">لایه ۲ · تأیید شماره تلگرام</p>
                <p className={user.phone_verified ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-semibold'}>
                  {user.phone_verified ? 'شماره از طریق تلگرام تأیید شده' : 'در مرحله ورود تلگرام تأیید می‌شود'}
                </p>
              </div>
              <div className="rounded-xl border border-indigo-500/20 bg-[#050816] p-3.5 space-y-1">
                <p className="text-slate-400">لایه ۳ · رضایت صریح + بررسی</p>
                <p className={user.isAdultVerified ? 'text-emerald-300 font-semibold' : 'text-cyan-300 font-semibold'}>
                  {user.isAdultVerified
                    ? 'تأیید نهایی انجام شده'
                    : user.adultVerification?.status === 'pending_review'
                      ? 'در انتظار بررسی'
                      : 'نیازمند ثبت رضایت‌نامه آگاهانه'}
                </p>
              </div>
            </div>

            {user.isAdultVerified ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-indigo-500/20">
                <span className="text-xs text-emerald-300 leading-relaxed">
                  دسترسی شما با رضایت کامل فعال است و هر لحظه می‌توانید آن را لغو و قفل کنید.
                </span>
                <button
                  type="button"
                  onClick={revokeAdultAccess}
                  className="w-full sm:w-auto rounded-xl border border-rose-500/40 px-4 py-2.5 text-xs text-rose-300 hover:bg-rose-500/15 min-h-[44px]"
                >
                  لغو رضایت و قفل مجدد بخش +۱۸
                </button>
              </div>
            ) : (
              <form onSubmit={submitAdultVerificationRequest} className="space-y-3 pt-2 border-t border-indigo-500/20">
                <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adultConsentChecked}
                    onChange={(e) => setAdultConsentChecked(e.target.checked)}
                    className="accent-rose-400 w-4 h-4 mt-0.5 shrink-0"
                  />
                  <span className="leading-relaxed">
                    منشور رضایت آگاهانه +۱۸ مدار را می‌پذیرم: تأیید می‌کنم بالای ۱۸ سال دارم، صرفاً در چارچوب محتوای مجاز و محترمانه مشارکت می‌کنم و می‌دانم هر زمان حق لغو دسترسی را دارم.
                  </span>
                </label>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={adultVerificationNote}
                    onChange={(e) => setAdultVerificationNote(e.target.value)}
                    placeholder="توضیح کوتاه درخواست احراز..."
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    type="submit"
                    disabled={!adultConsentChecked || !user.phone_verified}
                    className="w-full sm:w-auto rounded-xl bg-rose-500 px-5 py-2.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[46px]"
                  >
                    ثبت درخواست احراز +۱۸
                  </button>
                </div>
              </form>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
            {/* Read-only Telegram Account & Phone Verification Status (NEVER asks for phone again) */}
            <div className="madar-glass rounded-2xl p-4 sm:p-6 space-y-4 min-w-0">
              <div className="flex items-center gap-2 text-base font-bold text-white">
                <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>وضعیت احراز هویت تلگرام</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                ورود شما بدون نیاز به رمز عبور و به‌صورت مستقیم از طریق حساب تلگرام انجام می‌شود. شماره تلگرام فقط یک‌بار هنگام ورود اولیه ثبت می‌شود و برای سایر کاربران کاملاً مخفی است.
              </p>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between rounded-xl border border-[#23303E] bg-[#0E1621] px-4 py-3">
                  <span className="text-slate-400">اتصال حساب تلگرام</span>
                  <span className="text-emerald-300 font-semibold">فعال و تأییدشده</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[#23303E] bg-[#0E1621] px-4 py-3">
                  <span className="text-slate-400">وضعیت شماره تلگرام</span>
                  <span className={user.phone_verified ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-semibold'}>
                    {user.phone_verified ? 'ثبت و تأییدشده (محفوظ)' : 'تأییدنشده'}
                  </span>
                </div>
                {user.last_login_at && (
                  <div className="flex items-center justify-between rounded-xl border border-[#23303E] bg-[#0E1621] px-4 py-3">
                    <span className="text-slate-400">آخرین ورود</span>
                    <span className="font-mono text-slate-300">{user.last_login_at.slice(0, 16)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Active Sessions & Account Controls */}
            <div className="madar-glass rounded-2xl p-4 sm:p-6 space-y-4 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>نشست‌های فعال ({sessions.length})</span>
                </div>
                <button
                  type="button"
                  onClick={() => onLogout('others')}
                  className="text-xs text-amber-300 hover:text-amber-200 min-h-[36px]"
                >
                  خروج از سایر نشست‌ها
                </button>
              </div>
              <div className="divide-y divide-indigo-500/15 max-h-40 overflow-y-auto madar-scroll-y">
                {sessions.map((s) => (
                  <div key={s.id} className="py-2 text-xs flex items-center justify-between gap-2 text-slate-300">
                    <span className="truncate">
                      {s.device_label} {s.id === currentSessionId ? '(فعلی)' : ''}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 shrink-0">{s.created_at.slice(0, 10)}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-3 border-t border-indigo-500/20">
                <button
                  type="button"
                  onClick={() => onLogout('current')}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 px-4 py-2.5 text-xs text-slate-200 hover:border-slate-500 min-h-[44px]"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span>خروج از حساب</span>
                </button>
                <button
                  type="button"
                  onClick={() => onLogout('delete_account')}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 px-4 py-2.5 text-xs text-rose-300 hover:bg-rose-500/15 min-h-[44px]"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>حذف کامل حساب</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
