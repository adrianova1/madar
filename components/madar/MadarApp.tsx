'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  Compass,
  ExternalLink,
  Gamepad2,
  Heart,
  Mail,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  User,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  getTelegramWebApp,
  initTelegramMiniApp,
  openTelegramUrl,
  requestTelegramContact,
  triggerHaptic,
} from '@/lib/telegram-webapp';
import { madarSound } from './SoundFX';
import GalaxyHub from './GalaxyHub';
import VenusDating from './VenusDating';
import GamesArena from './GamesArena';
import NeptuneWhisper from './NeptuneWhisper';
import SaturnGroupHub from './SaturnGroupHub';
import StarEconomy from './StarEconomy';
import ProfileHub from './ProfileHub';
import type {
  GameSubTab,
  MadarUser,
  MainView,
  MissionItem,
  NotificationItem,
  OnboardingState,
  PlanetConfig,
  UserSessionItem,
} from './types';

function shouldDefaultToLiteMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (cores <= 2 || (mem !== undefined && mem <= 2)) return true;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      const rendererStr = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
      if (/SwiftShader|llvmpipe|Software/i.test(rendererStr)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export default function MadarApp() {
  const router = useRouter();

  // Auth Bearer token stored strictly in React memory (never localStorage/sessionStorage)
  const [token, setToken] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [user, setUser] = useState<MadarUser | null>(null);
  const [sessions, setSessions] = useState<UserSessionItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [planets, setPlanets] = useState<PlanetConfig[]>([]);
  const [missions, setMissions] = useState<MissionItem[]>([]);
  const [botUsername, setBotUsername] = useState('m4d4rbot');
  const [previewAvailable, setPreviewAvailable] = useState(false);

  // Onboarding state (forced channels -> one-time official Telegram contact share)
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [checkingChannels, setCheckingChannels] = useState(false);
  const [channelNotice, setChannelNotice] = useState<string | null>(null);
  const [contactState, setContactState] = useState<'idle' | 'waiting' | 'verified' | 'declined'>('idle');
  const [contactNotice, setContactNotice] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [view, setView] = useState<MainView>('home');
  const [gameSubTab, setGameSubTab] = useState<GameSubTab | null>(null);
  const [liteMode, setLiteMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearContactPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearContactPoll();
  }, [clearContactPoll]);

  const fetchSessionBundle = useCallback(
    async (activeToken: string | null) => {
      const res = await fetch('/api/auth/session', {
        headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
      });
      const data = await res.json();
      setPlanets(data.planets || []);
      setBotUsername(data.botUsername || 'm4d4rbot');
      setPreviewAvailable(Boolean(data.previewAvailable));

      if (data.authenticated && data.user) {
        const asUser =
          typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('asUser') === '1';

        // Verified primary/delegated admin opens directly into the hidden private /admin panel
        if (data.isAdmin && !asUser) {
          router.replace('/admin');
          return;
        }

        setUser(data.user);
        setSessions(data.sessions || []);
        setNotifications(data.notifications || []);
        setCurrentSessionId(data.currentSessionId || null);
        setOnboarding(data.onboarding || null);

        const starRes = await fetch('/api/stars', {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        if (starRes.ok) {
          const starData = await starRes.json();
          setMissions(starData.missions || []);
        }
      } else {
        setUser(null);
        setSessions([]);
        setNotifications([]);
        setOnboarding(null);
      }
    },
    [router]
  );

  const authenticateViaTelegram = useCallback(async () => {
    setAuthError(null);
    const tg = initTelegramMiniApp();
    if (tg.inTelegram && tg.initData) {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'telegram', initData: tg.initData }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        const asUser =
          typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('asUser') === '1';

        if (data.isAdmin && !asUser) {
          router.replace('/admin');
          return true;
        }

        setToken(data.token);
        setCurrentSessionId(data.currentSessionId);
        setBotUsername(data.botUsername || 'm4d4rbot');
        setPreviewAvailable(Boolean(data.previewAvailable));
        if (data.user) {
          setUser(data.user);
          setSessions(data.sessions || []);
          setNotifications(data.notifications || []);
          setPlanets(data.planets || []);
          setOnboarding(data.onboarding || null);
          const starRes = await fetch('/api/stars', {
            headers: { Authorization: `Bearer ${data.token}` },
          });
          if (starRes.ok) {
            const starData = await starRes.json();
            setMissions(starData.missions || []);
          }
        } else {
          await fetchSessionBundle(data.token);
        }
        return true;
      }
      setAuthError(data.error || 'تأیید ورود از طریق تلگرام ناموفق بود.');
      await fetchSessionBundle(null);
      return false;
    }
    await fetchSessionBundle(null);
    return false;
  }, [fetchSessionBundle, router]);

  // Bootstrap: Telegram Mini App auth ONLY
  useEffect(() => {
    let active = true;
    async function boot() {
      if (shouldDefaultToLiteMode()) {
        setLiteMode(true);
      }

      if (typeof window !== 'undefined') {
        const tabParam = new URLSearchParams(window.location.search).get('tab');
        if (
          tabParam === 'venus' ||
          tabParam === 'games' ||
          tabParam === 'whisper' ||
          tabParam === 'profile' ||
          tabParam === 'saturn' ||
          tabParam === 'shop'
        ) {
          setView(tabParam);
        }
      }

      await authenticateViaTelegram();
      if (active) setBooting(false);
    }

    void boot();
    return () => {
      active = false;
    };
  }, [authenticateViaTelegram]);

  // Telegram Mini App BackButton synchronization
  useEffect(() => {
    const tg = getTelegramWebApp();
    if (!tg?.BackButton) return;
    const goHome = () => setView('home');
    if (view !== 'home') {
      tg.BackButton.show();
      tg.BackButton.onClick(goHome);
    } else {
      tg.BackButton.hide();
    }
    return () => {
      tg.BackButton?.offClick(goHome);
    };
  }, [view]);

  function handleNavigate(nextView: MainView, nextGameTab?: GameSubTab) {
    triggerHaptic('light');
    if (nextView === 'games') {
      setGameSubTab(nextGameTab ?? null);
    }
    setView(nextView);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleToggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    madarSound.setEnabled(next);
  }

  async function handleClaimMission(missionId: string) {
    if (!token) return;
    const res = await fetch('/api/stars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'claim_mission', missionId }),
    });
    if (res.ok) {
      madarSound.playWinFanfare();
      await fetchSessionBundle(token);
    }
  }

  async function handleLogout(scope: 'current' | 'others' | 'delete_account') {
    if (!token) return;
    const res = await fetch(`/api/auth/session?scope=${scope}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      if (scope === 'others') {
        await fetchSessionBundle(token);
      } else {
        setToken(null);
        setCurrentSessionId(null);
        setUser(null);
        setSessions([]);
        setNotifications([]);
        setOnboarding(null);
      }
    }
  }

  // Step A: Verify forced channel membership server-side
  async function handleCheckChannels() {
    if (!token) return;
    setCheckingChannels(true);
    setChannelNotice(null);
    try {
      const res = await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'check_channels' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChannelNotice(data.error || 'بررسی عضویت ناموفق بود.');
        return;
      }
      if (data.channelsVerified) {
        triggerHaptic('medium');
        await fetchSessionBundle(token);
      } else {
        triggerHaptic('heavy');
        setOnboarding((prev) =>
          prev
            ? { ...prev, channelsVerified: false, channels: data.channels || prev.channels }
            : prev
        );
        setChannelNotice(
          data.error || 'هنوز عضو تمام کانال‌ها نشده‌اید. پس از عضویت دوباره بررسی کنید.'
        );
      }
    } finally {
      setCheckingChannels(false);
    }
  }

  // Poll server to confirm official Telegram webhook saved the shared contact
  const checkContactStatusOnce = useCallback(async () => {
    if (!token) return false;
    const res = await fetch('/api/auth/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'check_contact_status' }),
    });
    const data = await res.json();
    if (res.ok && data.phoneShared) {
      clearContactPoll();
      setContactState('verified');
      setContactNotice('شماره با موفقیت ثبت شد');
      triggerHaptic('medium');
      setTimeout(() => {
        void fetchSessionBundle(token);
      }, 900);
      return true;
    }
    return false;
  }, [clearContactPoll, fetchSessionBundle, token]);

  // Step B: Official Telegram requestContact() popup — zero manual phone input
  async function handleShareOfficialContact() {
    if (!token) return;
    setContactNotice(null);
    clearContactPoll();

    const result = await requestTelegramContact();
    if (!result.supported) {
      setContactState('idle');
      setContactNotice(
        'برای اشتراک‌گذاری شماره، لطفاً اپلیکیشن تلگرام خود را به‌روزرسانی کرده و مدار را از ربات باز کنید.'
      );
      return;
    }

    if (!result.shared) {
      setContactState('declined');
      await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'decline_contact' }),
      }).catch(() => {});
      setContactNotice('اشتراک‌گذاری شماره انجام نشد. هر زمان آماده بودید دوباره تلاش کنید.');
      return;
    }

    // Telegram accepted contact sharing — webhook receives and validates ownership server-side
    setContactState('waiting');
    setContactNotice('در حال ثبت شماره از طریق تلگرام...');
    const immediate = await checkContactStatusOnce();
    if (immediate) return;

    let attempts = 0;
    pollTimerRef.current = setInterval(async () => {
      attempts += 1;
      const done = await checkContactStatusOnce();
      if (done || attempts >= 10) {
        clearContactPoll();
        if (!done) {
          setContactState('idle');
          setContactNotice('اگر شماره را در تلگرام تأیید کردید، دکمه بررسی وضعیت را بزنید.');
        }
      }
    }, 1500);
  }

  const navItems: { id: MainView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'home', label: 'خانه', icon: Compass },
    { id: 'games', label: 'بازی‌ها', icon: Gamepad2 },
    { id: 'venus', label: 'ونوس', icon: Heart },
    { id: 'whisper', label: 'نجوا', icon: Mail },
    { id: 'profile', label: 'پروفایل', icon: User },
  ];

  // 1) Entry gate outside Telegram (clean minimal Persian UX, zero technical jargon)
  if (!booting && !user) {
    return (
      <div className="min-h-[100dvh] bg-[#0e1621] text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md madar-glass rounded-3xl p-6 sm:p-8 space-y-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#38bdf8]/15 border border-[#38bdf8]/35 mx-auto flex items-center justify-center">
            <Send className="w-7 h-7 text-[#38bdf8]" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-white">مدار</h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              برای ورود به مدار، ربات تلگرام را باز کنید.
            </p>
          </div>

          {authError && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 leading-relaxed">
              {authError}
            </div>
          )}

          <div className="space-y-2.5">
            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8] px-5 py-3.5 text-sm font-bold text-slate-950 hover:brightness-110 transition-all min-h-[48px]"
            >
              <ExternalLink className="w-4 h-4 shrink-0" />
              <span>ورود به مدار</span>
            </a>

            <button
              type="button"
              onClick={() => void authenticateViaTelegram()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#23303e] bg-[#0e1621] px-4 py-3 text-xs font-semibold text-slate-200 hover:border-[#38bdf8]/50 transition-colors min-h-[44px]"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>تلاش مجدد</span>
            </button>

            {previewAvailable && (
              <Link
                href="/preview"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-amber-400/35 bg-amber-400/10 px-4 py-3 text-xs font-semibold text-amber-200 hover:bg-amber-400/20 transition-colors min-h-[44px]"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>پیش‌نمایش محیط توسعه</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2) Forced Channel Membership Gate (Step A inside Telegram)
  if (!booting && user && onboarding && !onboarding.channelsVerified) {
    return (
      <div className="min-h-[100dvh] bg-[#0e1621] text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md madar-glass rounded-3xl p-6 sm:p-8 space-y-5">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-[#38bdf8]/15 border border-[#38bdf8]/35 mx-auto flex items-center justify-center">
              <Users className="w-6 h-6 text-[#38bdf8]" />
            </div>
            <h1 className="text-xl font-bold text-white">عضویت در کانال‌ها</h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              برای ادامه ورود به مدار، ابتدا در کانال‌های زیر عضو شوید و سپس دکمه بررسی عضویت را بزنید.
            </p>
          </div>

          <div className="space-y-2.5">
            {onboarding.channels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => openTelegramUrl(ch.inviteUrl)}
                className="w-full flex items-center justify-between gap-3 rounded-xl border border-[#23303e] bg-[#0e1621] px-4 py-3.5 text-right hover:border-[#38bdf8]/50 transition-colors min-h-[50px]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{ch.title}</p>
                  <p className="text-[11px] text-slate-400">
                    {ch.joined ? 'عضو هستید' : 'برای عضویت لمس کنید'}
                  </p>
                </div>
                {ch.joined ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <ExternalLink className="w-4 h-4 text-[#38bdf8] shrink-0" />
                )}
              </button>
            ))}
          </div>

          {channelNotice && (
            <div className="rounded-xl border border-amber-400/35 bg-amber-400/10 px-4 py-3 text-xs text-amber-200 leading-relaxed text-center">
              {channelNotice}
            </div>
          )}

          <button
            type="button"
            disabled={checkingChannels}
            onClick={() => void handleCheckChannels()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8] px-5 py-3.5 text-sm font-bold text-slate-950 hover:brightness-110 disabled:opacity-60 transition-all min-h-[48px]"
          >
            <RefreshCw className={`w-4 h-4 shrink-0 ${checkingChannels ? 'animate-spin' : ''}`} />
            <span>{checkingChannels ? 'در حال بررسی...' : 'بررسی عضویت'}</span>
          </button>
        </div>
      </div>
    );
  }

  // 3) One-Time Official Telegram Phone Sharing Gate (Step B — strictly after forced channels)
  if (!booting && user && onboarding && onboarding.channelsVerified && onboarding.needsContactShare) {
    return (
      <div className="min-h-[100dvh] bg-[#0e1621] text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md madar-glass rounded-3xl p-6 sm:p-8 space-y-6 text-center">
          <div
            className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center border ${
              contactState === 'verified'
                ? 'bg-emerald-400/15 border-emerald-400/40 text-emerald-300'
                : 'bg-[#38bdf8]/15 border-[#38bdf8]/35 text-[#38bdf8]'
            }`}
          >
            {contactState === 'verified' ? (
              <CheckCircle2 className="w-7 h-7" />
            ) : (
              <Phone className="w-6 h-6" />
            )}
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-bold text-white">
              {contactState === 'verified' ? 'شماره با موفقیت ثبت شد' : 'اشتراک‌گذاری شماره'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {contactState === 'verified'
                ? 'در حال ورود به مدار...'
                : 'برای تکمیل ورود اولیه و جلوگیری از حساب‌های تکراری، شماره تلگرام خود را یک‌بار از پنجره رسمی تلگرام به اشتراک بگذارید. شماره شما به هیچ کاربری نمایش داده نمی‌شود.'}
            </p>
          </div>

          {contactNotice && (
            <div
              className={`rounded-xl px-4 py-3 text-xs leading-relaxed border ${
                contactState === 'verified'
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                  : 'border-amber-400/35 bg-amber-400/10 text-amber-200'
              }`}
            >
              {contactNotice}
            </div>
          )}

          {contactState !== 'verified' && (
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={contactState === 'waiting'}
                onClick={() => void handleShareOfficialContact()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8] px-5 py-3.5 text-sm font-bold text-slate-950 hover:brightness-110 disabled:opacity-60 transition-all min-h-[48px]"
              >
                <Phone className="w-4 h-4 shrink-0" />
                <span>{contactState === 'waiting' ? 'در حال ثبت...' : 'اشتراک‌گذاری شماره'}</span>
              </button>

              <button
                type="button"
                onClick={() => void checkContactStatusOnce()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#23303e] bg-[#0e1621] px-4 py-3 text-xs font-semibold text-slate-200 hover:border-[#38bdf8]/50 transition-colors min-h-[44px]"
              >
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                <span>بررسی وضعیت ثبت شماره</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#0e1621] text-slate-100 flex flex-col">
      {/* Minimal Telegram-Native Top Bar (52px height) */}
      <header className="sticky top-0 z-30 h-[52px] border-b border-[#23303e] bg-[#17212b]/95 pt-safe">
        <div className="max-w-5xl mx-auto h-full px-3.5 sm:px-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => handleNavigate('home')}
            className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            مدار
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {navItems.map((item) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`relative py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active ? 'text-[#38bdf8] font-semibold' : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute -bottom-[15px] left-0 right-0 h-0.5 bg-[#38bdf8] rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleSound}
              title={soundEnabled ? 'قطع صدا' : 'روشن کردن صدا'}
              aria-label={soundEnabled ? 'قطع صدا' : 'روشن کردن صدا'}
              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                soundEnabled
                  ? 'border-[#38bdf8]/45 bg-[#38bdf8]/15 text-[#38bdf8]'
                  : 'border-[#23303e] bg-[#0e1621] text-slate-400 hover:text-white'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setLiteMode((v) => !v)}
              title={liteMode ? 'حالت سبک فعال است' : 'حالت سه‌بعدی فعال است'}
              aria-label="تغییر حالت گرافیک"
              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                !liteMode
                  ? 'border-[#8b5cf6]/45 bg-[#8b5cf6]/15 text-purple-200'
                  : 'border-[#23303e] bg-[#0e1621] text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
            </button>

            {user && (
              <button
                type="button"
                onClick={() => handleNavigate('shop')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400/12 border border-amber-400/35 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-400 hover:text-slate-950 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
              >
                <Star className="w-3.5 h-3.5" />
                <span className="font-mono tabular-nums">{user.totalStars}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Responsive Stage */}
      <main className="flex-1 max-w-5xl w-full min-w-0 mx-auto px-3 sm:px-5 pt-3.5 sm:pt-5 pb-20 md:pb-10">
        {booting ? (
          <div className="py-24 text-center text-sm text-slate-400">در حال اتصال به تلگرام...</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={liteMode ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={liteMode ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="min-w-0"
            >
              {view === 'home' && (
                <GalaxyHub
                  user={user}
                  planets={planets}
                  missions={missions}
                  notifications={notifications}
                  botUsername={botUsername}
                  liteMode={liteMode}
                  onToggleLiteMode={() => setLiteMode((v) => !v)}
                  onNavigate={handleNavigate}
                  onClaimMission={handleClaimMission}
                />
              )}

              {view === 'venus' && (
                <VenusDating
                  token={token}
                  user={user}
                  liteMode={liteMode}
                  onRequireAuth={() => handleNavigate('profile')}
                  onRefreshUser={() => fetchSessionBundle(token)}
                />
              )}

              {view === 'games' && (
                <GamesArena
                  token={token}
                  user={user}
                  initialSubTab={gameSubTab}
                  liteMode={liteMode}
                  onRefreshUser={() => fetchSessionBundle(token)}
                  onOpenAdultVerification={() => handleNavigate('profile')}
                />
              )}

              {view === 'whisper' && (
                <NeptuneWhisper
                  token={token}
                  user={user}
                  botUsername={botUsername}
                  onRequireAuth={() => handleNavigate('profile')}
                />
              )}

              {view === 'saturn' && (
                <SaturnGroupHub
                  token={token}
                  user={user}
                  onRequireAuth={() => handleNavigate('profile')}
                />
              )}

              {view === 'shop' && (
                <StarEconomy
                  token={token}
                  user={user}
                  botUsername={botUsername}
                  onRefreshUser={() => fetchSessionBundle(token)}
                  onRequireAuth={() => handleNavigate('profile')}
                />
              )}

              {view === 'profile' && (
                <ProfileHub
                  token={token}
                  user={user}
                  sessions={sessions}
                  currentSessionId={currentSessionId}
                  onRefreshUser={() => fetchSessionBundle(token)}
                  onLogout={handleLogout}
                />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* Quiet Desktop Footer — ZERO public admin link */}
      <footer className="hidden md:block border-t border-[#23303e] py-4 px-5 text-xs text-slate-500">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <span>مدار | MADAR</span>
          <div className="flex items-center gap-5">
            <button type="button" onClick={() => handleNavigate('saturn')} className="hover:text-[#38bdf8]">
              مدیریت گروه (زحل)
            </button>
            <button type="button" onClick={() => handleNavigate('shop')} className="hover:text-amber-300">
              فروشگاه ستاره
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile Fixed 5-Tab Telegram Bottom Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[#23303e] bg-[#17212b]/98 pb-safe">
        <div className="grid grid-cols-5 h-14 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`flex flex-col items-center justify-center min-h-[44px] transition-colors ${
                  active ? 'text-[#38bdf8]' : 'text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
