'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Check,
  Copy,
  Crown,
  Flame,
  Gamepad2,
  History,
  Moon,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { triggerHaptic } from '@/lib/telegram-webapp';
import HokmArena from './HokmArena';
import MafiaArena from './MafiaArena';
import TruthDareArena from './TruthDareArena';
import QuizArena from './QuizArena';
import type { GameSubTab, MadarUser, SanitizedEngineRoom } from './types';

interface LeaderRow {
  username: string;
  display_name: string;
  level: number;
  total_score: number;
  games_played: number;
}

interface HistoryRow {
  id: number;
  game_type: string;
  score: number;
  result: string;
  stars_earned: number;
  created_at: string;
}

interface GamesArenaProps {
  token: string | null;
  user: MadarUser | null;
  initialSubTab: GameSubTab;
  liteMode?: boolean;
  onRefreshUser: () => Promise<void>;
  onOpenAdultVerification?: () => void;
}

const GAME_TABS: {
  id: GameSubTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  engineType?: 'hokm' | 'mafia' | 'truth_dare' | 'quiz';
}[] = [
  { id: 'hangout', label: 'دورهمی آنلاین', icon: Users },
  { id: 'hokm', label: 'حکم پاسور', icon: Crown, engineType: 'hokm' },
  { id: 'mafia', label: 'مافیا خودکار', icon: Moon, engineType: 'mafia' },
  { id: 'truth', label: 'بطری سه‌بعدی', icon: Flame, engineType: 'truth_dare' },
  { id: 'quiz', label: 'کوییز زنده', icon: Zap, engineType: 'quiz' },
];

export default function GamesArena({
  token,
  user,
  initialSubTab,
  liteMode = false,
  onRefreshUser,
  onOpenAdultVerification,
}: GamesArenaProps) {
  const [subTab, setSubTab] = useState<GameSubTab>(initialSubTab);
  const [prevInitialTab, setPrevInitialTab] = useState<GameSubTab>(initialSubTab);
  if (initialSubTab !== prevInitialTab) {
    setPrevInitialTab(initialSubTab);
    setSubTab(initialSubTab);
  }

  const [activeRoom, setActiveRoom] = useState<SanitizedEngineRoom | null>(null);
  const [isAdultVerified, setIsAdultVerified] = useState(Boolean(user?.isAdultVerified));
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [rewardBanner, setRewardBanner] = useState<string | null>(null);
  const [hangoutBusy, setHangoutBusy] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const loadMeta = useCallback(async () => {
    const res = await fetch('/api/games', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const data = await res.json();
      setIsAdultVerified(Boolean(data.isAdultVerified));
      setLeaderboard(data.leaderboard || []);
      setHistory(data.myHistory || []);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await loadMeta();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadMeta]);

  async function startOrSwitchHangout(nextGame: 'hokm' | 'mafia' | 'truth_dare' | 'quiz') {
    if (!token) {
      setRewardBanner('برای ساخت اتاق دورهمی آنلاین ابتدا وارد حساب مدار شوید.');
      return;
    }
    setHangoutBusy(true);
    triggerHaptic('medium');
    try {
      const payload =
        activeRoom && activeRoom.isHangout
          ? { action: 'switch_game', roomCode: activeRoom.roomCode, nextGame }
          : { action: 'create_room', gameType: nextGame, isHangout: true };

      const res = await fetch('/api/games/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.room) {
        setActiveRoom(data.room);
      } else {
        setRewardBanner(data.error || 'خطا در تغییر بازی دورهمی');
      }
    } finally {
      setHangoutBusy(false);
    }
  }

  async function copyRoomCode() {
    if (!activeRoom) return;
    try {
      await navigator.clipboard.writeText(activeRoom.roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // ignore clipboard errors in restricted webviews
    }
  }

  const handleRewardNotice = useCallback(
    (msg: string) => {
      setRewardBanner(msg);
      void loadMeta();
    },
    [loadMeta]
  );

  // Determine which game arena to render inside Hangout Room
  const effectiveArena: 'hokm' | 'mafia' | 'truth' | 'quiz' | null =
    subTab === 'hangout'
      ? activeRoom?.gameType === 'hokm'
        ? 'hokm'
        : activeRoom?.gameType === 'mafia'
          ? 'mafia'
          : activeRoom?.gameType === 'truth_dare'
            ? 'truth'
            : activeRoom?.gameType === 'quiz'
              ? 'quiz'
              : null
      : subTab;

  return (
    <div className="space-y-6 min-w-0">
      {/* Arena Header + Touch-Safe Swipeable Game Switcher (Zero Scroll Lock) */}
      <section className="madar-glass rounded-3xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <Image
              src="/images/madar/jupiter.jpg"
              alt="میدان بازی‌های مشتری مدار"
              width={52}
              height={52}
              referrerPolicy="no-referrer"
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border border-cyan-400/40 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-white truncate">میدان بازی‌ها و دورهمی آنلاین</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                موتور مرکزی سرورمحور · جابه‌جایی روان بین حکم، مافیا، بطری سه‌بعدی و کوییز
              </p>
            </div>
          </div>

          {activeRoom && (
            <button
              type="button"
              onClick={copyRoomCode}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-3.5 py-2 text-xs font-mono text-cyan-200 hover:bg-cyan-400/20 whitespace-nowrap shrink-0 self-start sm:self-auto min-h-[40px]"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
              <span>اتاق فعال: {activeRoom.roomCode}</span>
            </button>
          )}
        </div>

        {/* Touch-safe Horizontal Scrollable Game Selector */}
        <div className="w-full max-w-full madar-scroll-x">
          <div className="inline-flex items-center gap-2 py-1 min-w-full sm:min-w-0">
            {GAME_TABS.map((t) => {
              const Icon = t.icon;
              const active = subTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setSubTab(t.id);
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 min-h-[44px] transition-all ${
                    active
                      ? 'border-amber-400 bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20'
                      : 'border-indigo-500/25 bg-[#050816] text-slate-200 hover:border-cyan-400/50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {rewardBanner && (
        <div className="rounded-2xl border border-amber-400/45 bg-amber-400/12 px-4 py-3 text-xs sm:text-sm text-amber-100 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
            <span>{rewardBanner}</span>
          </span>
          <button type="button" onClick={() => setRewardBanner(null)} className="text-xs text-amber-300 underline">
            بستن
          </button>
        </div>
      )}

      {/* ==================== ONLINE HANGOUT ROOM BAR ==================== */}
      {subTab === 'hangout' && (
        <section className="madar-glass-cyan rounded-3xl p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-cyan-300">اتاق دورهمی یکپارچه مدار</p>
              <h2 className="text-base sm:text-lg font-bold text-white mt-0.5">
                {activeRoom?.isHangout
                  ? `اتاق دورهمی ${activeRoom.roomCode} (${activeRoom.players.length} بازیکن)`
                  : 'یک اتاق دورهمی بساز و آزادانه بین ۴ بازی جابه‌جا شو'}
              </h2>
            </div>
            {activeRoom?.isHangout && (
              <div className="flex items-center -space-x-2 space-x-reverse">
                {activeRoom.players.slice(0, 6).map((p) => (
                  <div
                    key={p.id}
                    title={p.name}
                    className="w-8 h-8 rounded-full border-2 border-[#050816] flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: p.avatarColor }}
                  >
                    {p.avatarInitials}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { id: 'hokm' as const, label: 'حکم پاسور', desc: 'میز ۴ نفره واقعی' },
              { id: 'mafia' as const, label: 'مافیا خودکار', desc: 'گرداننده هوشمند' },
              { id: 'truth_dare' as const, label: 'بطری سه‌بعدی', desc: '۶ حالت دورهمی' },
              { id: 'quiz' as const, label: 'کوییز زنده', desc: 'رقابت سرعت و دقت' },
            ].map((g) => {
              const isCurrent = activeRoom?.isHangout && activeRoom.gameType === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={hangoutBusy}
                  onClick={() => startOrSwitchHangout(g.id)}
                  className={`rounded-2xl border p-3.5 text-right transition-all min-h-[68px] ${
                    isCurrent
                      ? 'border-cyan-400 bg-cyan-400/20 text-white'
                      : 'border-indigo-500/25 bg-[#050816] text-slate-200 hover:border-amber-400/50'
                  }`}
                >
                  <p className="text-xs sm:text-sm font-bold">{g.label}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{g.desc}</p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ==================== ACTIVE GAME ARENA ==================== */}
      {effectiveArena === 'hokm' && (
        <HokmArena
          token={token}
          room={activeRoom}
          liteMode={liteMode}
          onRoomChange={setActiveRoom}
          onRewardNotice={handleRewardNotice}
          onRefreshUser={onRefreshUser}
        />
      )}

      {effectiveArena === 'mafia' && (
        <MafiaArena
          token={token}
          room={activeRoom}
          liteMode={liteMode}
          onRoomChange={setActiveRoom}
          onRewardNotice={handleRewardNotice}
          onRefreshUser={onRefreshUser}
        />
      )}

      {effectiveArena === 'truth' && (
        <TruthDareArena
          token={token}
          room={activeRoom}
          isAdultVerified={isAdultVerified}
          liteMode={liteMode}
          onRoomChange={setActiveRoom}
          onRewardNotice={handleRewardNotice}
          onRefreshUser={onRefreshUser}
          onOpenAdultVerification={onOpenAdultVerification}
        />
      )}

      {effectiveArena === 'quiz' && (
        <QuizArena
          token={token}
          room={activeRoom}
          liteMode={liteMode}
          onRoomChange={setActiveRoom}
          onRewardNotice={handleRewardNotice}
          onRefreshUser={onRefreshUser}
        />
      )}

      {subTab === 'hangout' && !effectiveArena && (
        <div className="madar-glass rounded-3xl p-8 text-center space-y-3">
          <Gamepad2 className="w-10 h-10 text-cyan-400 mx-auto" />
          <p className="text-base font-bold text-white">یکی از ۴ بازی بالا را انتخاب کن تا اتاق دورهمی باز شود</p>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            پس از ساخت اتاق، می‌توانی کد اتاق را به دوستانت بدهی و هر زمان وسط دورهمی بدون خروج از اتاق، بازی را عوض کنی.
          </p>
        </div>
      )}

      {/* ==================== LEADERBOARD & MATCH HISTORY ==================== */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 madar-glass rounded-2xl p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span>جدول رتبه‌بندی کهکشانی بازی‌ها</span>
          </div>
          {leaderboard.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">هنوز امتیازی ثبت نشده است.</p>
          ) : (
            <div className="divide-y divide-indigo-500/15">
              {leaderboard.slice(0, 6).map((row, i) => (
                <div key={row.username} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono font-bold text-amber-300 w-5">#{i + 1}</span>
                    <span className="text-slate-100 font-semibold truncate">{row.display_name}</span>
                    <span className="text-slate-500 hidden sm:inline">@{row.username}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                    <span className="text-slate-400">{row.games_played} بازی</span>
                    <span className="text-cyan-300 font-bold">{row.total_score}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 madar-glass rounded-2xl p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <History className="w-4 h-4 text-cyan-400" />
            <span>تاریخچه مسابقات شما</span>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              اولین بازی خود را تکمیل کن تا تاریخچه و ستاره‌ها اینجا ثبت شوند.
            </p>
          ) : (
            <div className="divide-y divide-indigo-500/15 max-h-56 overflow-y-auto madar-scroll-y">
              {history.slice(0, 8).map((h) => (
                <div key={h.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="text-slate-100 font-semibold truncate">{h.result}</p>
                    <p className="text-[11px] text-slate-500">{h.created_at.slice(0, 10)}</p>
                  </div>
                  <span className="font-mono tabular-nums text-amber-300 shrink-0">+{h.stars_earned}★</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
