'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { motion, useMotionValue, useTransform, type PanInfo } from 'motion/react';
import {
  Ban,
  Bookmark,
  CheckCircle2,
  EyeOff,
  Flag,
  Heart,
  Info,
  MapPin,
  MessageCircle,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Star,
  UserX,
  X,
} from 'lucide-react';
import { triggerHaptic, triggerHapticNotice } from '@/lib/telegram-webapp';
import BlindDateArena from './BlindDateArena';
import { madarSound } from './SoundFX';
import type { MadarUser } from './types';

interface Candidate {
  id: number;
  username: string;
  displayName: string;
  subscriptionTier: string;
  phoneVerified?: boolean;
  avatarColor: string;
  avatarInitials: string;
  equippedFrame: string;
  age: number;
  gender: string;
  city: string;
  isOnlineVisible: boolean;
  bio: string;
  goal: string;
  interests: string[];
  traits: string[];
  compatibilityScore: number;
  tasteBoost?: number;
  sharedInterests: string[];
  matchReasons: string[];
}

interface MatchItem {
  match_id: number;
  compatibility_score: number;
  created_at: string;
  partner_id: number;
  display_name: string;
  username: string;
  avatar_color: string;
  avatar_initials: string;
  city: string;
  hide_city: number;
}

interface ChatMsg {
  id: number;
  sender_id: number;
  content: string;
  created_at: string;
}

interface TasteSummary {
  signalsLearned: number;
  topLearnedInterests: string[];
}

interface VenusDatingProps {
  token: string | null;
  user: MadarUser | null;
  liteMode?: boolean;
  onRequireAuth: () => void;
  onRefreshUser?: () => Promise<void>;
}

export default function VenusDating({ token, user, liteMode = false, onRequireAuth, onRefreshUser }: VenusDatingProps) {
  const [subTab, setSubTab] = useState<'discover' | 'blind' | 'matches' | 'favorites'>('discover');
  const [cityFilter, setCityFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [ageRestricted, setAgeRestricted] = useState(false);
  const [datingProfileRequired, setDatingProfileRequired] = useState(false);
  const [datingProfilePaused, setDatingProfilePaused] = useState(false);
  const [optInBio, setOptInBio] = useState(user?.datingProfile?.datingBio || user?.bio || '');
  const [optInLookingFor, setOptInLookingFor] = useState(
    user?.datingProfile?.lookingFor || 'آشنایی جدی و گفت‌وگوی عمیق'
  );
  const [optInGenderPref, setOptInGenderPref] = useState<'all' | 'زن' | 'مرد'>('all');
  const [optInShowCity, setOptInShowCity] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [favorites, setFavorites] = useState<{ id: number; display_name: string; username: string; avatar_initials: string; avatar_color: string; city: string; hide_city: number }[]>([]);
  const [tasteSummary, setTasteSummary] = useState<TasteSummary>({ signalsLearned: 0, topLearnedInterests: [] });
  const [activeMatch, setActiveMatch] = useState<MatchItem | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [introInput, setIntroInput] = useState('');
  const [showIntroBox, setShowIntroBox] = useState(false);
  const [fullProfileOpen, setFullProfileOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Swipe motion values for Ginger-inspired tactile card deck
  const dragX = useMotionValue(0);
  const rotate = useTransform(dragX, [-180, 0, 180], [-10, 0, 10]);
  const likeOpacity = useTransform(dragX, [35, 110], [0, 1]);
  const passOpacity = useTransform(dragX, [-110, -35], [1, 0]);

  const loadVenus = useCallback(async () => {
    if (!token) return;
    const qs = cityFilter ? `?city=${encodeURIComponent(cityFilter)}` : '';
    const res = await fetch(`/api/venus${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.ageRestricted) {
      setAgeRestricted(true);
      setDatingProfileRequired(false);
    } else if (data.datingProfileRequired) {
      setAgeRestricted(false);
      setDatingProfileRequired(true);
      setDatingProfilePaused(Boolean(data.datingProfilePaused));
    } else {
      setAgeRestricted(false);
      setDatingProfileRequired(false);
      setDatingProfilePaused(false);
      setCandidates(data.candidates || []);
      setMatches(data.matches || []);
      setFavorites(data.favorites || []);
      if (data.tasteSummary) setTasteSummary(data.tasteSummary);
    }
    setLoading(false);
  }, [token, cityFilter]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const run = async () => {
      if (active) await loadVenus();
    };
    void run();
    return () => {
      active = false;
    };
  }, [token, loadVenus]);

  const loadMessages = useCallback(
    async (matchId: number) => {
      if (!token) return;
      const res = await fetch(`/api/venus?matchId=${matchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setMessages(data.messages || []);
    },
    [token]
  );

  useEffect(() => {
    if (!activeMatch || !token) return;
    let active = true;
    const run = async () => {
      const res = await fetch(`/api/venus?matchId=${activeMatch.match_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (active && res.ok) setMessages(data.messages || []);
    };
    void run();
    return () => {
      active = false;
    };
  }, [activeMatch, token]);

  if (!token || !user) {
    return (
      <div className="madar-glass rounded-3xl p-8 text-center space-y-4">
        <h2 className="text-xl font-bold text-white">سیاره ونوس — کشف هوشمند و آشنایی ناشناس</h2>
        <p className="text-sm text-slate-400">برای مشاهده پیشنهادهای هم‌ساز و آشنایی ناشناس وارد حساب مدار شوید.</p>
        <button
          type="button"
          onClick={onRequireAuth}
          className="rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 min-h-[46px]"
        >
          ورود به حساب مدار
        </button>
      </div>
    );
  }

  if (ageRestricted) {
    return (
      <div className="madar-glass rounded-3xl border-rose-500/35 p-8 text-center space-y-3">
        <ShieldAlert className="w-9 h-9 text-rose-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">محدودیت سنی ۱۸+ سیاره ونوس</h2>
        <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
          دسترسی به سیستم کشف، سوایپ و آشنایی ناشناس ونوس منحصراً برای کاربران ۱۸ سال به بالا مجاز است. پروفایل اجتماعی و بازی‌های غیربزرگسال شما کاملاً فعال هستند.
        </p>
      </div>
    );
  }

  async function handleSaveOrResumeDatingProfile(action: 'save' | 'resume' | 'pause') {
    if (!token) return;
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(
        action === 'save'
          ? {
              datingProfileAction: 'save',
              datingBio: optInBio,
              lookingFor: optInLookingFor,
              datingGenderPref: optInGenderPref,
              datingShowCity: optInShowCity,
            }
          : { datingProfileAction: action }
      ),
    });
    const data = await res.json();
    setNotice(data.message || data.error);
    if (res.ok) {
      await Promise.all([loadVenus(), onRefreshUser ? onRefreshUser() : Promise.resolve()]);
    }
  }

  if (datingProfileRequired) {
    return (
      <div className="max-w-2xl mx-auto madar-glass rounded-3xl p-5 sm:p-8 space-y-6">
        <div className="flex items-center gap-4">
          <Image
            src="/images/madar/venus.jpg"
            alt="سیاره ونوس"
            width={56}
            height={56}
            referrerPolicy="no-referrer"
            className="w-14 h-14 rounded-full object-cover border border-rose-400/40 shrink-0"
          />
          <div>
            <p className="text-xs text-rose-300">پروفایل آشنایی کاملاً مستقل و اختیاری (۱۸+)</p>
            <h2 className="text-lg sm:text-xl font-bold text-white mt-0.5">
              {datingProfilePaused ? 'پروفایل آشنایی ونوس تو موقتاً متوقف است' : 'فعال‌سازی اختیاری پروفایل آشنایی ونوس'}
            </h2>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
          در مدار، پروفایل اجتماعی و بازی‌ها کاملاً جدا از پروفایل آشنایی است. برای کشف سوایپ‌محور و آشنایی ناشناس، می‌توانی پروفایل مستقل ونوس را بسازی و هر زمان بخواهی متوقف یا حذف کنی.
        </p>

        {notice && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
            {notice}
          </div>
        )}

        {datingProfilePaused ? (
          <button
            type="button"
            onClick={() => handleSaveOrResumeDatingProfile('resume')}
            className="rounded-xl bg-rose-500 px-6 py-3 text-sm font-bold text-white hover:bg-rose-400 min-h-[46px]"
          >
            فعال‌سازی مجدد پروفایل ونوس
          </button>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300 block">معرفی اختصاصی در ونوس</label>
              <textarea
                rows={3}
                value={optInBio}
                onChange={(e) => setOptInBio(e.target.value)}
                placeholder="درباره روحیه، ارزش‌ها و سبک گفت‌وگوی خودت بنویس..."
                className="w-full rounded-xl border border-indigo-500/30 bg-[#050816] px-3.5 py-2.5 text-base sm:text-sm text-white"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 block">هدف در ونوس</label>
                <input
                  type="text"
                  value={optInLookingFor}
                  onChange={(e) => setOptInLookingFor(e.target.value)}
                  className="w-full rounded-xl border border-indigo-500/30 bg-[#050816] px-3.5 py-2.5 text-base sm:text-sm text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 block">ترجیح نمایش</label>
                <select
                  value={optInGenderPref}
                  onChange={(e) => setOptInGenderPref(e.target.value as 'all' | 'زن' | 'مرد')}
                  className="w-full rounded-xl border border-indigo-500/30 bg-[#050816] px-3.5 py-2.5 text-base sm:text-sm text-white"
                >
                  <option value="all">همه کاربران هم‌ساز</option>
                  <option value="زن">زن</option>
                  <option value="مرد">مرد</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer min-h-[38px]">
              <input
                type="checkbox"
                checked={optInShowCity}
                onChange={(e) => setOptInShowCity(e.target.checked)}
                className="accent-rose-400 w-4 h-4"
              />
              <span>نمایش شهر من روی کارت آشنایی ونوس</span>
            </label>
            <button
              type="button"
              onClick={() => handleSaveOrResumeDatingProfile('save')}
              className="w-full sm:w-auto rounded-xl bg-rose-500 px-6 py-3 text-sm font-bold text-white hover:bg-rose-400 min-h-[46px]"
            >
              ساخت و فعال‌سازی پروفایل مستقل ونوس
            </button>
          </div>
        )}
      </div>
    );
  }

  const currentCandidate = candidates[0] || null;

  async function handleAction(type: 'like' | 'superlike' | 'pass' | 'favorite' | 'intro', targetUserId: number) {
    if (!token) return;
    triggerHaptic(type === 'like' || type === 'superlike' ? 'medium' : 'light');
    if (type === 'superlike') madarSound.playWinFanfare();
    else madarSound.playClick();

    const res = await fetch('/api/venus', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type,
        targetUserId,
        introNote: type === 'intro' ? introInput : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error || 'خطا در ثبت عملیات');
      return;
    }

    if (data.matched) {
      triggerHapticNotice('success');
      madarSound.playWinFanfare();
      setNotice('مچینگ دوطرفه ثبت شد! اکنون در تب «مچینگ‌ها» می‌توانید گفت‌وگو را شروع کنید.');
    } else if (type === 'superlike') {
      setNotice('Super Like ویژه ارسال شد و در یادگیری سلیقه تو ثبت گردید!');
    } else if (type === 'favorite') {
      setNotice('پروفایل به فهرست نشان‌شده‌ها اضافه شد.');
    } else if (type === 'intro') {
      setNotice('درخواست آشنایی همراه با یادداشت کوتاه ارسال شد.');
      setIntroInput('');
      setShowIntroBox(false);
    } else {
      setNotice(null);
    }

    dragX.set(0);
    setFullProfileOpen(false);
    await loadVenus();
  }

  function handleSwipeEnd(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (!currentCandidate) return;
    if (info.offset.x > 95) {
      void handleAction('like', currentCandidate.id);
    } else if (info.offset.x < -95) {
      void handleAction('pass', currentCandidate.id);
    }
  }

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !activeMatch || !chatInput.trim()) return;
    const res = await fetch('/api/venus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'send_message', matchId: activeMatch.match_id, content: chatInput }),
    });
    if (res.ok) {
      setChatInput('');
      await loadMessages(activeMatch.match_id);
    }
  }

  async function handleBlockOrReport(targetUserId: number, kind: 'block' | 'report') {
    if (!token) return;
    const res = await fetch('/api/venus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(
        kind === 'block'
          ? { type: 'block', targetUserId }
          : { type: 'report', targetUserId, reason: 'گزارش رفتار نامناسب یا پروفایل مشکوک از بخش ونوس' }
      ),
    });
    const data = await res.json();
    setNotice(data.message || data.error);
    setActiveMatch(null);
    await loadVenus();
  }

  async function handleUnmatch(matchId: number) {
    if (!token) return;
    const res = await fetch('/api/venus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'unmatch', matchId }),
    });
    const data = await res.json();
    setNotice(data.message || data.error);
    setActiveMatch(null);
    await loadVenus();
  }

  return (
    <div className="space-y-6 min-w-0">
      {/* Venus Cosmic Header + Touch-Safe Sub-Tabs */}
      <section className="madar-glass rounded-3xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <Image
              src="/images/madar/venus.jpg"
              alt="سیاره ونوس"
              width={52}
              height={52}
              referrerPolicy="no-referrer"
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border border-rose-400/45 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-white truncate">ونوس · کشف هوشمند و آشنایی ناشناس</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                سوایپ سریع، یادگیری سلیقه قابل توضیح و آشنایی ناشناس با تایید دوطرفه (۱۸+)
              </p>
            </div>
          </div>

          <div className="w-full sm:w-auto max-w-full madar-scroll-x">
            <div className="inline-flex items-center gap-1 p-1 bg-[#050816] border border-indigo-500/25 rounded-xl min-w-full sm:min-w-0">
              {[
                { id: 'discover', label: `کشف (${candidates.length})` },
                { id: 'blind', label: 'آشنایی ناشناس' },
                { id: 'matches', label: `مچینگ (${matches.length})` },
                { id: 'favorites', label: `نشان‌شده (${favorites.length})` },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSubTab(t.id as 'discover' | 'blind' | 'matches' | 'favorites')}
                  className={`flex-1 sm:flex-none px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[40px] ${
                    subTab === t.id
                      ? 'bg-gradient-to-l from-rose-500 to-purple-500 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {notice && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs sm:text-sm text-amber-100 flex items-center justify-between gap-4">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-amber-300 hover:text-white shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ==================== TAB 1: GINGER-INSPIRED SWIPE DISCOVERY ==================== */}
      {subTab === 'discover' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Taste Learning & Filter Rail */}
          <aside className="lg:col-span-4 space-y-4">
            <div className="madar-glass rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <SlidersHorizontal className="w-4 h-4 text-rose-300" />
                <span>فیلتر و یادگیری سلیقه</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 block">فیلتر شهر</label>
                <select
                  value={cityFilter}
                  onChange={(e) => setCityFilter(e.target.value)}
                  className="w-full rounded-xl border border-indigo-500/30 bg-[#050816] px-3 py-2.5 text-base sm:text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="">همه شهرهای ایران</option>
                  <option value="تهران">تهران</option>
                  <option value="اصفهان">اصفهان</option>
                  <option value="شیراز">شیراز</option>
                  <option value="رشت">رشت</option>
                  <option value="مشهد">مشهد</option>
                  <option value="تبریز">تبریز</option>
                </select>
              </div>

              {/* Explainable Taste Learning Card */}
              <div className="rounded-xl border border-purple-400/25 bg-purple-500/10 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-purple-200 inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    <span>موتور یادگیری سلیقه</span>
                  </span>
                  <span className="font-mono tabular-nums text-cyan-300">{tasteSummary.signalsLearned} سیگنال</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {tasteSummary.topLearnedInterests.length > 0
                    ? `بر اساس انتخاب‌های قبلی تو، علایق «${tasteSummary.topLearnedInterests.join('، ')}» در اولویت بالاتری قرار گرفته‌اند.`
                    : 'با هر لایک، سوپرلایک یا ردکردن، پیشنهادهای بعدی هوشمندتر با سلیقه تو هماهنگ می‌شوند.'}
                </p>
              </div>

              {/* Quick jump to Blind Date */}
              <button
                type="button"
                onClick={() => setSubTab('blind')}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-purple-400/40 bg-purple-500/15 py-2.5 text-xs font-semibold text-purple-100 hover:bg-purple-500/25 min-h-[44px]"
              >
                <EyeOff className="w-4 h-4 text-cyan-300" />
                <span>تجربه آشنایی ناشناس (Blind Date)</span>
              </button>

              <button
                type="button"
                onClick={() => handleSaveOrResumeDatingProfile('pause')}
                className="w-full rounded-xl border border-slate-700 bg-[#050816] py-2.5 text-xs text-slate-300 hover:border-rose-400/50 hover:text-rose-200 min-h-[40px]"
              >
                توقف موقت پروفایل آشنایی (بدون اثر بر بازی‌ها)
              </button>
            </div>
          </aside>

          {/* Swipeable Discovery Deck */}
          <div className="lg:col-span-8">
            {loading ? (
              <div className="madar-glass rounded-3xl p-10 text-center text-sm text-slate-400">
                در حال محاسبه سازگاری تخمینی در سرور...
              </div>
            ) : !currentCandidate ? (
              <div className="madar-glass rounded-3xl p-10 text-center space-y-4">
                <p className="text-base font-bold text-white">پیشنهاد تازه‌ای در این فیلتر باقی نمانده است</p>
                <p className="text-xs text-slate-400">
                  می‌توانی فیلتر شهر را باز کنی یا همین حالا وارد بخش «آشنایی ناشناس» شوی.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {cityFilter && (
                    <button
                      type="button"
                      onClick={() => setCityFilter('')}
                      className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs text-slate-200 min-h-[42px]"
                    >
                      نمایش همه شهرها
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSubTab('blind')}
                    className="rounded-xl bg-purple-500 px-5 py-2.5 text-xs font-bold text-white min-h-[42px]"
                  >
                    شروع آشنایی ناشناس
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-[11px] text-slate-400 text-center">
                  کارت را به راست بکش = لایک · به چپ بکش = رد · یا از دکمه‌های پایین استفاده کن
                </p>

                <motion.article
                  key={currentCandidate.id}
                  drag={liteMode ? false : 'x'}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.7}
                  style={liteMode ? undefined : { x: dragX, rotate }}
                  onDragEnd={handleSwipeEnd}
                  className="relative madar-glass rounded-3xl overflow-hidden cursor-grab active:cursor-grabbing select-none"
                >
                  {/* Live Swipe Direction Stamps */}
                  {!liteMode && (
                    <>
                      <motion.div
                        style={{ opacity: likeOpacity }}
                        className="pointer-events-none absolute top-5 right-5 z-20 rounded-xl border-2 border-emerald-400 bg-emerald-500/20 px-3 py-1 text-sm font-extrabold text-emerald-300 rotate-6"
                      >
                        علاقه‌مندم
                      </motion.div>
                      <motion.div
                        style={{ opacity: passOpacity }}
                        className="pointer-events-none absolute top-5 left-5 z-20 rounded-xl border-2 border-rose-400 bg-rose-500/20 px-3 py-1 text-sm font-extrabold text-rose-300 -rotate-6"
                      >
                        رد کردن
                      </motion.div>
                    </>
                  )}

                  {/* Portrait Hero Header */}
                  <div
                    className="relative p-5 sm:p-7 flex flex-col sm:flex-row sm:items-end justify-between gap-5 border-b border-indigo-500/20"
                    style={{
                      background: `linear-gradient(135deg, ${currentCandidate.avatarColor} 0%, #0a1026 85%)`,
                    }}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-18 h-18 sm:w-20 sm:h-20 rounded-2xl bg-slate-950/65 border border-white/20 flex items-center justify-center text-2xl font-bold text-white shrink-0 shadow-lg">
                        {currentCandidate.avatarInitials}
                      </div>
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h2 className="text-xl sm:text-2xl font-bold text-white truncate">
                            {currentCandidate.displayName}،{' '}
                            <span className="font-mono tabular-nums">{currentCandidate.age}</span>
                          </h2>
                          {currentCandidate.phoneVerified && (
                            <CheckCircle2 className="w-4 h-4 text-cyan-300 shrink-0" />
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200/85">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            {currentCandidate.city}
                          </span>
                          <span>·</span>
                          <span>{currentCandidate.goal}</span>
                        </div>
                      </div>
                    </div>

                    {/* Explicitly Labeled Estimated Compatibility */}
                    <div className="text-right sm:text-left shrink-0">
                      <p className="text-[11px] text-slate-300">سازگاری تخمینی (نه قطعی)</p>
                      <p className="text-3xl font-bold font-mono tabular-nums text-amber-300">
                        {currentCandidate.compatibilityScore}%
                      </p>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-5 sm:p-7 space-y-5">
                    <p className="text-sm sm:text-base text-slate-200 leading-relaxed">
                      {currentCandidate.bio || 'کاربر هنوز بیوگرافی ننوشته است.'}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-indigo-500/20">
                      <div className="space-y-1.5">
                        <h3 className="text-xs font-semibold text-cyan-300">چرا این پیشنهاد نمایش داده شد؟</h3>
                        <ul className="space-y-1 text-xs sm:text-sm text-slate-300">
                          {currentCandidate.matchReasons.slice(0, fullProfileOpen ? 6 : 3).map((r, i) => (
                            <li key={i}>• {r}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-1.5">
                        <h3 className="text-xs font-semibold text-purple-300">علایق و ویژگی‌ها</h3>
                        <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                          {currentCandidate.interests.join(' · ')}
                        </p>
                        {currentCandidate.traits.length > 0 && (
                          <p className="text-xs text-cyan-300/90 pt-1">
                            {currentCandidate.traits.join(' / ')}
                          </p>
                        )}
                      </div>
                    </div>

                    {fullProfileOpen && (
                      <div className="rounded-2xl border border-indigo-500/25 bg-[#050816] p-4 text-xs text-slate-300 space-y-1.5">
                        <p>
                          نام کاربری مدار: <strong className="font-mono text-white">@{currentCandidate.username}</strong>
                        </p>
                        <p>
                          اشتراک: <strong className="text-amber-300">{currentCandidate.subscriptionTier.toUpperCase()}</strong>
                          {currentCandidate.tasteBoost ? ` · اثر یادگیری سلیقه: ${currentCandidate.tasteBoost > 0 ? '+' : ''}${currentCandidate.tasteBoost}%` : ''}
                        </p>
                        <p className="text-slate-400">
                          شماره تماس و اطلاعات خصوصی هرگز نمایش داده نمی‌شوند.
                        </p>
                      </div>
                    )}

                    {showIntroBox && (
                      <div className="rounded-xl border border-indigo-500/30 bg-[#050816] p-3.5 space-y-2.5">
                        <label className="text-xs text-slate-300 block">یادداشت کوتاه درخواست آشنایی (حداکثر ۱۸۰ کاراکتر)</label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={introInput}
                            onChange={(e) => setIntroInput(e.target.value)}
                            maxLength={180}
                            placeholder="سلام! علایق مشترک جالبی داریم..."
                            className="flex-1 rounded-lg border border-slate-700 bg-[#0a1026] px-3 py-2 text-base sm:text-sm text-white"
                          />
                          <button
                            type="button"
                            onClick={() => handleAction('intro', currentCandidate.id)}
                            className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-bold text-slate-950 min-h-[42px]"
                          >
                            ارسال درخواست
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Ginger-Style Tactile Action Dock */}
                    <div className="pt-4 border-t border-indigo-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center justify-center sm:justify-start gap-2.5">
                        <button
                          type="button"
                          onClick={() => handleAction('pass', currentCandidate.id)}
                          aria-label="رد کردن"
                          className="w-12 h-12 rounded-2xl border border-slate-700 bg-[#050816] text-slate-300 hover:border-rose-400 hover:text-rose-300 flex items-center justify-center transition-transform active:scale-90"
                        >
                          <X className="w-5 h-5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAction('superlike', currentCandidate.id)}
                          aria-label="سوپرلایک ویژه"
                          title="Super Like ویژه"
                          className="w-12 h-12 rounded-2xl border border-cyan-400/50 bg-cyan-400/15 text-cyan-300 hover:bg-cyan-400 hover:text-slate-950 flex items-center justify-center transition-transform active:scale-90"
                        >
                          <Star className="w-5 h-5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAction('like', currentCandidate.id)}
                          aria-label="علاقه‌مندم"
                          className="h-12 px-6 rounded-2xl bg-gradient-to-l from-rose-500 to-pink-500 text-white font-bold text-sm inline-flex items-center gap-2 hover:brightness-110 transition-transform active:scale-95 shadow-lg shadow-rose-500/25"
                        >
                          <Heart className="w-5 h-5" />
                          <span>لایک</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAction('favorite', currentCandidate.id)}
                          aria-label="افزودن به نشان‌شده"
                          title="افزودن به علاقه‌مندی‌ها"
                          className="w-12 h-12 rounded-2xl border border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400 hover:text-slate-950 flex items-center justify-center transition-transform active:scale-90"
                        >
                          <Bookmark className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="flex items-center justify-center sm:justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setFullProfileOpen((v) => !v)}
                          className="inline-flex items-center gap-1 rounded-xl border border-indigo-500/25 px-3 py-2 text-xs text-cyan-200 hover:border-cyan-400 min-h-[40px]"
                        >
                          <Info className="w-3.5 h-3.5" />
                          <span>{fullProfileOpen ? 'بستن جزئیات' : 'پروفایل کامل'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowIntroBox((v) => !v)}
                          className="inline-flex items-center gap-1 rounded-xl border border-indigo-500/25 px-3 py-2 text-xs text-slate-200 hover:border-amber-400 min-h-[40px]"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>پیام</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBlockOrReport(currentCandidate.id, 'block')}
                          title="بلاک"
                          className="p-2 text-slate-400 hover:text-rose-300 min-h-[40px]"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBlockOrReport(currentCandidate.id, 'report')}
                          title="گزارش"
                          className="p-2 text-slate-400 hover:text-amber-300 min-h-[40px]"
                        >
                          <Flag className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.article>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 2: REAL BLIND DATE MODE ==================== */}
      {subTab === 'blind' && (
        <BlindDateArena token={token} onSessionMatched={loadVenus} />
      )}

      {/* ==================== TAB 3: ACTIVE MATCHES & PRIVATE CHAT ==================== */}
      {subTab === 'matches' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 madar-glass rounded-2xl p-4 space-y-2">
            <h2 className="text-sm font-bold text-white px-2 py-1">مچینگ‌های فعال تو</h2>
            {matches.length === 0 ? (
              <p className="text-xs text-slate-400 px-2 py-6">
                هنوز مچینگ دوطرفه‌ای ثبت نشده است. با لایک در تب کشف یا رضایت دوطرفه در آشنایی ناشناس، اولین مچینگت را بساز!
              </p>
            ) : (
              matches.map((m) => (
                <button
                  key={m.match_id}
                  type="button"
                  onClick={() => setActiveMatch(m)}
                  className={`w-full flex items-center justify-between gap-3 rounded-xl p-3 text-right transition-colors min-h-[56px] ${
                    activeMatch?.match_id === m.match_id
                      ? 'bg-rose-500/15 border border-rose-400/40'
                      : 'hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
                      style={{ backgroundColor: m.avatar_color }}
                    >
                      {m.avatar_initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{m.display_name}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {m.hide_city ? 'شهر مخفی' : m.city} · سازگاری تخمینی {m.compatibility_score}%
                      </p>
                    </div>
                  </div>
                  <MessageCircle className="w-4 h-4 text-rose-300 shrink-0" />
                </button>
              ))
            )}
          </div>

          <div className="lg:col-span-7 madar-glass rounded-2xl flex flex-col min-h-[380px]">
            {!activeMatch ? (
              <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-slate-400">
                یک مچینگ را از فهرست انتخاب کن تا گفت‌وگوی خصوصی باز شود.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-indigo-500/20">
                  <div>
                    <p className="text-sm font-bold text-white">{activeMatch.display_name}</p>
                    <p className="text-xs text-slate-400">@{activeMatch.username}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleUnmatch(activeMatch.match_id)}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-300 px-2.5 py-1.5"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>لغو مچینگ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBlockOrReport(activeMatch.partner_id, 'block')}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-300 px-2.5 py-1.5"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>بلاک</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 p-4 space-y-3 overflow-y-auto madar-scroll-y max-h-80">
                  {messages.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">
                      اولین پیام محترمانه را بفرست و گفت‌وگو را شروع کن.
                    </p>
                  ) : (
                    messages.map((msg) => {
                      const mine = msg.sender_id === user.id;
                      return (
                        <div key={msg.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                          <div
                            className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                              mine ? 'bg-amber-400 text-slate-950 font-medium' : 'bg-slate-800 text-slate-100'
                            }`}
                          >
                            <p>{msg.content}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <form onSubmit={handleSendChat} className="p-3.5 border-t border-indigo-500/20 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="پیام خود را بنویسید..."
                    className="flex-1 min-w-0 rounded-xl border border-indigo-500/30 bg-[#050816] px-3.5 py-2.5 text-base sm:text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 min-h-[44px]"
                  >
                    ارسال
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 4: FAVORITES ==================== */}
      {subTab === 'favorites' && (
        <div className="madar-glass rounded-2xl p-5">
          {favorites.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">هنوز پروفایلی را به علاقه‌مندی‌ها اضافه نکرده‌اید.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {favorites.map((f) => (
                <div key={f.id} className="rounded-xl border border-indigo-500/20 bg-[#050816] p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
                      style={{ backgroundColor: f.avatar_color }}
                    >
                      {f.avatar_initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{f.display_name}</p>
                      <p className="text-xs text-slate-400 truncate">{f.hide_city ? 'شهر مخفی' : f.city}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAction('like', f.id)}
                    className="rounded-lg bg-rose-500/20 text-rose-200 px-3 py-1.5 text-xs hover:bg-rose-500 hover:text-white shrink-0 min-h-[36px]"
                  >
                    لایک
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
