'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Crown,
  Flame,
  History,
  LogIn,
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
  initialSubTab: GameSubTab | null;
  liteMode?: boolean;
  onRefreshUser: () => Promise<void>;
  onOpenAdultVerification?: () => void;
}

const GAME_CARDS: {
  id: Exclude<GameSubTab, 'hangout'>;
  engineType: 'hokm' | 'mafia' | 'truth_dare' | 'quiz';
  title: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}[] = [
  { id: 'hokm', engineType: 'hokm', title: 'حکم چهارنفره', sub: 'پاسور، حاکم و امتیاز دست', icon: Crown, accent: 'text-amber-400' },
  { id: 'mafia', engineType: 'mafia', title: 'مافیا خودکار', sub: 'شب و روز با گرداننده سرور', icon: Moon, accent: 'text-purple-400' },
  { id: 'truth', engineType: 'truth_dare', title: 'جرئت و حقیقت', sub: 'بطری سه‌بعدی و ۶ دسته', icon: Flame, accent: 'text-rose-400' },
  { id: 'quiz', engineType: 'quiz', title: 'کوییز زنده', sub: 'رقابت سرعت و دقت', icon: Zap, accent: 'text-[#38bdf8]' },
];

export default function GamesArena({
  token,
  user,
  initialSubTab,
  liteMode = false,
  onRefreshUser,
  onOpenAdultVerification,
}: GamesArenaProps) {
  const [selectedGame, setSelectedGame] = useState<GameSubTab | null>(initialSubTab);
  const [prevInitialTab, setPrevInitialTab] = useState<GameSubTab | null>(initialSubTab);
  if (initialSubTab !== prevInitialTab) {
    setPrevInitialTab(initialSubTab);
    setSelectedGame(initialSubTab);
  }

  const [activeRoom, setActiveRoom] = useState<SanitizedEngineRoom | null>(null);
  const [isAdultVerified, setIsAdultVerified] = useState(Boolean(user?.isAdultVerified));
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [rewardBanner, setRewardBanner] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
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
    if (!token) return;
    setBusy(true);
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
        setSelectedGame('hangout');
      } else {
        setRewardBanner(data.error || 'خطا در شروع دورهمی');
      }
    } finally {
      setBusy(false);
    }
  }

  async function joinRoomByCode(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !joinCode.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/games/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'join_room', roomCode: joinCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (res.ok && data.room) {
        setActiveRoom(data.room);
        setJoinCode('');
        const gt = data.room.gameType as SanitizedEngineRoom['gameType'];
        setSelectedGame(
          data.room.isHangout ? 'hangout' : gt === 'truth_dare' ? 'truth' : gt
        );
      } else {
        setRewardBanner(data.error || 'اتاق بازی یافت نشد.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyRoomCode() {
    if (!activeRoom) return;
    try {
      await navigator.clipboard.writeText(activeRoom.roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  }

  const handleRewardNotice = useCallback(
    (msg: string) => {
      setRewardBanner(msg);
      void loadMeta();
    },
    [loadMeta]
  );

  function exitToPicker() {
    triggerHaptic('light');
    setSelectedGame(null);
    setActiveRoom(null);
  }

  const effectiveArena: 'hokm' | 'mafia' | 'truth' | 'quiz' | null =
    selectedGame === 'hangout'
      ? activeRoom?.gameType === 'hokm'
        ? 'hokm'
        : activeRoom?.gameType === 'mafia'
          ? 'mafia'
          : activeRoom?.gameType === 'truth_dare'
            ? 'truth'
            : activeRoom?.gameType === 'quiz'
              ? 'quiz'
              : null
      : selectedGame;

  // ==================== FOCUSED DEDICATED GAME VIEW (Zero Duplicate Menus) ====================
  if (selectedGame !== null) {
    const titleMap: Record<GameSubTab, string> = {
      hangout: 'دورهمی آنلاین',
      hokm: 'حکم چهارنفره',
      mafia: 'مافیا خودکار',
      truth: 'جرئت و حقیقت',
      quiz: 'کوییز زنده',
    };

    return (
      <div className="space-y-4 min-w-0">
        {/* Clean Single-Row Focused Top Bar */}
        <div className="madar-glass rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={exitToPicker}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white min-h-[38px] shrink-0"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>همه بازی‌ها</span>
          </button>

          <h1 className="text-sm sm:text-base font-bold text-white truncate">{titleMap[selectedGame]}</h1>

          {activeRoom ? (
            <button
              type="button"
              onClick={copyRoomCode}
              className="inline-flex items-center gap-1 rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/10 px-2.5 py-1.5 text-xs font-mono text-[#38bdf8] shrink-0 min-h-[36px]"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{activeRoom.roomCode}</span>
            </button>
          ) : (
            <span className="w-14 shrink-0" />
          )}
        </div>

        {rewardBanner && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/12 px-4 py-2.5 text-xs text-amber-100 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
              <span>{rewardBanner}</span>
            </span>
            <button type="button" onClick={() => setRewardBanner(null)} className="text-amber-300 underline shrink-0">
              بستن
            </button>
          </div>
        )}

        {/* Hangout Game Switcher (Shown ONLY inside Hangout mode) */}
        {selectedGame === 'hangout' && (
          <div className="madar-glass rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-[#38bdf8] font-semibold">
                {activeRoom?.isHangout
                  ? `اتاق دورهمی (${activeRoom.players.length} بازیکن)`
                  : 'یک بازی انتخاب کن تا اتاق دورهمی باز شود'}
              </span>
              {activeRoom?.isHangout && (
                <div className="flex items-center -space-x-2 space-x-reverse">
                  {activeRoom.players.slice(0, 5).map((p) => (
                    <div
                      key={p.id}
                      title={p.name}
                      className="w-7 h-7 rounded-full border-2 border-[#17212b] flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ backgroundColor: p.avatarColor }}
                    >
                      {p.avatarInitials}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {GAME_CARDS.map((g) => {
                const isCurrent = activeRoom?.isHangout && activeRoom.gameType === g.engineType;
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={busy}
                    onClick={() => startOrSwitchHangout(g.engineType)}
                    className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors min-h-[42px] ${
                      isCurrent
                        ? 'border-[#38bdf8] bg-[#38bdf8] text-slate-950'
                        : 'border-[#23303e] bg-[#0e1621] text-slate-200 hover:border-[#38bdf8]/50'
                    }`}
                  >
                    {g.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
      </div>
    );
  }

  // ==================== CLEAN SINGLE PICKER VIEW (Zero Duplication) ====================
  return (
    <div className="space-y-5 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">بازی‌ها</h1>
          <p className="text-xs text-slate-400 mt-0.5">یک بازی انتخاب کن یا وارد اتاق دوستانت شو</p>
        </div>
        <button
          type="button"
          onClick={() => {
            triggerHaptic('light');
            setSelectedGame('hangout');
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#38bdf8] px-3.5 py-2.5 text-xs font-bold text-slate-950 hover:brightness-110 min-h-[40px] shrink-0"
        >
          <Users className="w-4 h-4" />
          <span>دورهمی آنلاین</span>
        </button>
      </div>

      {rewardBanner && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/12 px-4 py-2.5 text-xs text-amber-100 flex items-center justify-between gap-3">
          <span>{rewardBanner}</span>
          <button type="button" onClick={() => setRewardBanner(null)} className="text-amber-300 underline shrink-0">
            بستن
          </button>
        </div>
      )}

      {/* Single Visual 2x2 Game Launcher Grid */}
      <section className="grid grid-cols-2 gap-3">
        {GAME_CARDS.map((g) => {
          const Icon = g.icon;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setActiveRoom(null);
                setSelectedGame(g.id);
              }}
              className="madar-glass rounded-2xl p-4 sm:p-5 text-right hover:border-[#38bdf8]/50 transition-colors flex flex-col justify-between gap-4 min-h-[120px]"
            >
              <div className="w-10 h-10 rounded-xl bg-[#0e1621] border border-[#23303e] flex items-center justify-center">
                <Icon className={`w-5 h-5 ${g.accent}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm sm:text-base font-bold text-white truncate">{g.title}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 truncate">{g.sub}</p>
              </div>
            </button>
          );
        })}
      </section>

      {/* Join Room by Code */}
      <form onSubmit={joinRoomByCode} className="madar-glass rounded-2xl p-3.5 flex items-center gap-2.5">
        <input
          type="text"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="کد اتاق دوست (مثلاً MDR-4821)"
          className="flex-1 min-w-0 rounded-xl border border-[#23303e] bg-[#0e1621] px-3.5 py-2.5 text-base sm:text-sm font-mono text-white dir-ltr text-left focus:border-[#38bdf8] focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !joinCode.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#38bdf8]/15 border border-[#38bdf8]/40 px-4 py-2.5 text-xs font-bold text-[#38bdf8] hover:bg-[#38bdf8] hover:text-slate-950 disabled:opacity-50 min-h-[44px] shrink-0"
        >
          <LogIn className="w-4 h-4" />
          <span>ورود</span>
        </button>
      </form>

      {/* Compact Leaderboard & Recent Matches */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 madar-glass rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span>برترین‌ها</span>
          </div>
          {leaderboard.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">هنوز امتیازی ثبت نشده است.</p>
          ) : (
            <div className="divide-y divide-[#23303e]">
              {leaderboard.slice(0, 5).map((row, i) => (
                <div key={row.username} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-amber-300 w-5">#{i + 1}</span>
                    <span className="text-slate-100 font-semibold truncate">{row.display_name}</span>
                  </div>
                  <span className="font-mono tabular-nums text-[#38bdf8] font-bold shrink-0">{row.total_score}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 madar-glass rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <History className="w-4 h-4 text-[#38bdf8]" />
            <span>بازی‌های اخیر</span>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">هنوز مسابقه‌ای ثبت نشده است.</p>
          ) : (
            <div className="divide-y divide-[#23303e] max-h-48 overflow-y-auto madar-scroll-y">
              {history.slice(0, 6).map((h) => (
                <div key={h.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-200 truncate">{h.result}</span>
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
