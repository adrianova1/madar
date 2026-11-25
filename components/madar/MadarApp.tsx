'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Compass,
  ExternalLink,
  Gamepad2,
  Heart,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getTelegramWebApp, initTelegramMiniApp, triggerHaptic } from '@/lib/telegram-webapp';
import { madarSound } from './SoundFX';
import GalaxyHub from './GalaxyHub';
import VenusDating from './VenusDating';
import GamesArena from './GamesArena';
import NeptuneWhisper from './NeptuneWhisper';
import SaturnGroupHub from './SaturnGroupHub';
import StarEconomy from './StarEconomy';
import ProfileHub from './ProfileHub';
import AdminConsole from './AdminConsole';
import type {
  GameSubTab,
  MadarUser,
  MainView,
  MissionItem,
  NotificationItem,
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
  // Auth Bearer token stored strictly in React memory (never localStorage/sessionStorage)
  const [token, setToken] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [user, setUser] = useState<MadarUser | null>(null);
  const [sessions, setSessions] = useState<UserSessionItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [planets, setPlanets] = useState<PlanetConfig[]>([]);
  const [missions, setMissions] = useState<MissionItem[]>([]);
  const [botUsername, setBotUsername] = useState('MadarBot');

  const [view, setView] = useState<MainView>('home');
  const [gameSubTab, setGameSubTab] = useState<GameSubTab | null>(null);
  const [liteMode, setLiteMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false); // Muted at start per user preference
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const fetchSessionBundle = useCallback(async (activeToken: string | null) => {
    const res = await fetch('/api/auth/session', {
      headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
    });
    const data = await res.json();
    setPlanets(data.planets || []);
    setBotUsername(data.botUsername || 'MadarBot');

    if (data.authenticated && data.user) {
      setUser(data.user);
      setSessions(data.sessions || []);
      setNotifications(data.notifications || []);
      setCurrentSessionId(data.currentSessionId || null);

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
    }
  }, []);

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
        setToken(data.token);
        setCurrentSessionId(data.currentSessionId);
        await fetchSessionBundle(data.token);
        return true;
      }
      setAuthError(data.error || 'تأیید امضای تلگرام ناموفق بود.');
      await fetchSessionBundle(null);
      return false;
    }
    await fetchSessionBundle(null);
    return false;
  }, [fetchSessionBundle]);

  // Bootstrap: real Telegram Mini App auth ONLY (zero demo_enter auto-login!)
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
          tabParam === 'shop' ||
          tabParam === 'admin'
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

  async function handleAuthSuccess(newToken: string, sessionId: string) {
    setToken(newToken);
    setCurrentSessionId(sessionId);
    await fetchSessionBundle(newToken);
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
      }
    }
  }

  const navItems: { id: MainView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'home', label: 'خانه', icon: Compass },
    { id: 'games', label: 'بازی‌ها', icon: Gamepad2 },
    { id: 'venus', label: 'ونوس', icon: Heart },
    { id: 'whisper', label: 'نجوا', icon: Mail },
    { id: 'profile', label: 'پروفایل', icon: User },
  ];

  // Direct Telegram Mini App Entry Gate when opened outside Telegram without an authenticated session
  if (!booting && !user) {
    return (
      <div className="min-h-[100dvh] bg-[#0e1621] text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md madar-glass rounded-3xl p-6 sm:p-8 space-y-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#38bdf8]/15 border border-[#38bdf8]/35 mx-auto flex items-center justify-center">
            <Send className="w-7 h-7 text-[#38bdf8]" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-white">مدار | MADAR</h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              برای حفظ امنیت هویت و جلوگیری از ورود آزمایشی، ورود به مدار منحصراً از طریق Telegram Mini App انجام می‌شود.
            </p>
          </div>

          {authError && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
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
              <span>باز کردن در تلگرام (@{botUsername})</span>
            </a>

            <button
              type="button"
              onClick={() => void authenticateViaTelegram()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#23303e] bg-[#0e1621] px-4 py-3 text-xs font-semibold text-slate-200 hover:border-[#38bdf8]/50 transition-colors min-h-[44px]"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>تلاش مجدد برای اتصال به تلگرام</span>
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            احراز هویت واقعی با امضای رمزنگاری‌شده Telegram initData
          </p>
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
                  onAuthSuccess={handleAuthSuccess}
                  onRefreshUser={() => fetchSessionBundle(token)}
                  onLogout={handleLogout}
                />
              )}

              {view === 'admin' && (
                <AdminConsole onPlanetsUpdated={() => fetchSessionBundle(token)} />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {/* Quiet Desktop Footer */}
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
            <button type="button" onClick={() => handleNavigate('admin')} className="hover:text-purple-300">
              پنل مدیریت
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
