'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Compass, Gamepad2, Heart, Mail, Sparkles, Star, User, Volume2, VolumeX } from 'lucide-react';
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
  const [gameSubTab, setGameSubTab] = useState<GameSubTab>('hokm');
  const [liteMode, setLiteMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false); // Muted at start per confirmed choice
  const [booting, setBooting] = useState(true);

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

  // Bootstrap hardware detection + Telegram Mini App SDK + deep-link tab + initial session
  useEffect(() => {
    let active = true;
    async function boot() {
      if (shouldDefaultToLiteMode()) {
        setLiteMode(true);
      }

      const tg = initTelegramMiniApp();

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

      if (tg.inTelegram && tg.initData) {
        const res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'telegram', initData: tg.initData }),
        });
        if (res.ok && active) {
          const data = await res.json();
          setToken(data.token);
          setCurrentSessionId(data.currentSessionId);
          await fetchSessionBundle(data.token);
          setBooting(false);
          return;
        }
      }

      const demoRes = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'demo_enter' }),
      });
      if (demoRes.ok && active) {
        const data = await demoRes.json();
        setToken(data.token);
        setCurrentSessionId(data.currentSessionId);
        await fetchSessionBundle(data.token);
      } else if (active) {
        await fetchSessionBundle(null);
      }
      if (active) setBooting(false);
    }

    boot();
    return () => {
      active = false;
    };
  }, [fetchSessionBundle]);

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
    if (nextGameTab) setGameSubTab(nextGameTab);
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
    { id: 'venus', label: 'ونوس', icon: Heart },
    { id: 'games', label: 'بازی‌ها', icon: Gamepad2 },
    { id: 'whisper', label: 'نجوا', icon: Mail },
    { id: 'profile', label: 'پروفایل', icon: User },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#050816] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Cosmic Top Bar (<= 56px height) */}
      <header className="sticky top-0 z-30 h-14 border-b border-indigo-500/20 bg-[#050816]/95 pt-safe">
        <div className="max-w-7xl mx-auto h-full px-3.5 sm:px-6 flex items-center justify-between gap-4">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => handleNavigate('home')}
            className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-md px-1"
          >
            مدار
          </button>

          {/* Zone 2: 5 Single-Line Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {navItems.map((item) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`relative py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active ? 'text-white font-semibold' : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-gradient-to-l from-cyan-400 to-purple-400 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Sound + Lite Mode Icon Toggles + Star Wallet / Sign In */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleSound}
              title={soundEnabled ? 'قطع افکت‌های صوتی' : 'فعال‌سازی افکت‌های صوتی'}
              aria-label={soundEnabled ? 'قطع صدا' : 'روشن کردن صدا'}
              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                soundEnabled
                  ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200'
                  : 'border-indigo-500/25 bg-[#0a1026] text-slate-400 hover:text-white'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setLiteMode((v) => !v)}
              title={liteMode ? 'حالت سبک فعال است (کلیک برای سه‌بعدی)' : 'گرافیک سه‌بعدی فعال است (کلیک برای حالت سبک)'}
              aria-label="تغییر حالت سه‌بعدی و سبک"
              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                !liteMode
                  ? 'border-purple-400/50 bg-purple-500/15 text-purple-200'
                  : 'border-indigo-500/25 bg-[#0a1026] text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
            </button>

            {user ? (
              <button
                type="button"
                onClick={() => handleNavigate('shop')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400/15 border border-amber-400/45 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400 hover:text-slate-950 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
              >
                <Star className="w-3.5 h-3.5" />
                <span className="font-mono tabular-nums">{user.totalStars}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleNavigate('profile')}
                className="rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
              >
                ورود
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Responsive Stage */}
      <main className="flex-1 max-w-7xl w-full min-w-0 mx-auto px-3.5 sm:px-6 pt-4 sm:pt-5 pb-24 md:pb-12">
        {booting ? (
          <div className="py-24 text-center text-sm text-cyan-200/80">
            در حال همگام‌سازی منظومه کیهانی مدار...
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={liteMode ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={liteMode ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
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

      {/* Quiet Editorial Desktop Footer */}
      <footer className="hidden md:block border-t border-indigo-500/20 py-5 px-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <span>MADAR | مدار — جهان تو، آدم‌های تو، بازی‌های تو</span>
          <div className="flex items-center gap-5">
            <button type="button" onClick={() => handleNavigate('saturn')} className="hover:text-cyan-300">
              زحل (گروه و هوش مصنوعی)
            </button>
            <button type="button" onClick={() => handleNavigate('shop')} className="hover:text-amber-300">
              فروشگاه ستاره و دعوت
            </button>
            <button type="button" onClick={() => handleNavigate('admin')} className="hover:text-purple-300">
              پنل مدیریت
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile Fixed 5-Tab Bottom Bar (56px height, Telegram Safe Area aware) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-indigo-500/25 bg-[#050816]/95 pb-safe">
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
                  active ? 'text-cyan-300' : 'text-slate-400'
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
