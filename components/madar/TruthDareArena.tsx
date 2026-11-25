'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  Flame,
  HelpCircle,
  Lock,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  Timer,
  Trophy,
} from 'lucide-react';
import { triggerHaptic, triggerHapticNotice } from '@/lib/telegram-webapp';
import { ADULT_TD_CATEGORY, PUBLIC_TD_CATEGORIES } from '@/lib/truth-dare-prompts';
import SpinBottle3D from './SpinBottle3D';
import { madarSound } from './SoundFX';
import type { SanitizedEngineRoom } from './types';

interface TruthDareArenaProps {
  token: string | null;
  room: SanitizedEngineRoom | null;
  isAdultVerified: boolean;
  liteMode: boolean;
  onRoomChange: (room: SanitizedEngineRoom | null) => void;
  onRewardNotice: (msg: string) => void;
  onRefreshUser: () => Promise<void>;
  onOpenAdultVerification?: () => void;
}

const TD_CATEGORIES: { id: string; label: string; adult?: boolean }[] = [
  { id: 'همه', label: 'همه (عمومی)' },
  ...PUBLIC_TD_CATEGORIES.map((c) => ({ id: c, label: c })),
  { id: ADULT_TD_CATEGORY, label: ADULT_TD_CATEGORY, adult: true },
];

const QUICK_REACTIONS = ['😂', '🔥', '👏', '❤️', '😮'];

export default function TruthDareArena({
  token,
  room,
  isAdultVerified,
  liteMode,
  onRoomChange,
  onRewardNotice,
  onRefreshUser,
  onOpenAdultVerification,
}: TruthDareArenaProps) {
  const [selectedCategory, setSelectedCategory] = useState('دوستانه');
  const [namesInput, setNamesInput] = useState('نیلوفر، سارا، کیان، تارا، آرمان');
  const [busy, setBusy] = useState(false);
  const [isBottleAnimating, setIsBottleAnimating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(45);

  const td = room?.gameType === 'truth_dare' ? room.truthDare : undefined;
  const activePlayers = room ? room.players.filter((p) => p.status !== 'left') : [];

  const syncFromServer = useCallback(async () => {
    if (!room || room.gameType !== 'truth_dare' || !token) return;
    try {
      const res = await fetch(`/api/games/engine?roomCode=${encodeURIComponent(room.roomCode)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.room) onRoomChange(data.room);
      }
    } catch {
      // ignore transient error
    }
  }, [room, token, onRoomChange]);

  // Live 3s polling sync
  useEffect(() => {
    if (!room || room.gameType !== 'truth_dare' || !token || td?.phase === 'FINISHED') return;
    const id = setInterval(() => void syncFromServer(), 3000);
    return () => clearInterval(id);
  }, [room, token, td?.phase, syncFromServer]);

  // Countdown synced to backend turnDeadline (triggers server sync at 0)
  useEffect(() => {
    if (!td?.turnDeadline) return;
    let syncedZero = false;
    const update = () => {
      const rem = Math.max(0, Math.ceil((td.turnDeadline! - Date.now()) / 1000));
      setSecondsLeft(rem);
      if (rem === 0 && !syncedZero) {
        syncedZero = true;
        void syncFromServer();
      }
    };
    update();
    const t = setInterval(update, 500);
    return () => clearInterval(t);
  }, [td?.turnDeadline, syncFromServer]);

  async function callEngine(payload: Record<string, unknown>) {
    if (!token) {
      setErr('ابتدا وارد حساب تلگرام خود شوید.');
      return null;
    }
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/api/games/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || 'خطا در اجرای دستور جرئت و حقیقت');
        return null;
      }
      if (data.room) onRoomChange(data.room);
      if (data.message) {
        onRewardNotice(data.message);
        madarSound.playWinFanfare();
        triggerHapticNotice('success');
        await onRefreshUser();
      }
      return data.room as SanitizedEngineRoom | undefined;
    } finally {
      setBusy(false);
    }
  }

  async function createTruthDareRoom() {
    if (selectedCategory === ADULT_TD_CATEGORY && !isAdultVerified) {
      setErr('دسته بزرگسالان ۱۸+ قفل است و نیاز به احراز ۱۸+ در پروفایل دارد.');
      return;
    }
    const list = namesInput
      .split(/[،,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await callEngine({
      action: 'create_room',
      gameType: 'truth_dare',
      category: selectedCategory,
      playerNames: list,
    });
  }

  async function handleSpinBottle() {
    if (!room || isBottleAnimating) return;
    triggerHaptic('medium');
    setIsBottleAnimating(true);
    const updated = await callEngine({
      action: 'td_spin',
      roomCode: room.roomCode,
      category: selectedCategory,
    });
    if (!updated) setIsBottleAnimating(false);
  }

  async function handleChooseMode(mode: 'truth' | 'dare') {
    if (!room) return;
    madarSound.playClick();
    triggerHaptic('light');
    await callEngine({
      action: 'td_choose_mode',
      roomCode: room.roomCode,
      mode,
      category: selectedCategory,
    });
  }

  async function handleResolve(outcome: 'completed' | 'skipped') {
    if (!room) return;
    if (outcome === 'completed') madarSound.playCorrect();
    else madarSound.playClick();
    await callEngine({
      action: 'td_resolve',
      roomCode: room.roomCode,
      outcome,
    });
  }

  async function handleReaction(emoji: string) {
    if (!room) return;
    madarSound.playClick();
    await callEngine({
      action: 'td_react',
      roomCode: room.roomCode,
      emoji,
    });
  }

  // ==================== LOBBY ====================
  if (!td || !room) {
    return (
      <div className="madar-glass rounded-3xl p-5 sm:p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-white">میز جرئت و حقیقت</h2>
          <p className="text-xs text-slate-400">همه دسته‌های عمومی بازند؛ فقط ۱۸+ قفل واقعی دارد</p>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
            {err}
          </div>
        )}

        <div className="madar-scroll-x">
          <div className="inline-flex items-center gap-2 py-1">
            {TD_CATEGORIES.map((cat) => {
              const locked = Boolean(cat.adult && !isAdultVerified);
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    if (locked) {
                      onOpenAdultVerification?.();
                      return;
                    }
                    setSelectedCategory(cat.id);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 min-h-[40px] transition-colors ${
                    locked
                      ? 'border-rose-500/35 bg-rose-500/10 text-rose-300'
                      : active
                        ? 'border-[#38bdf8] bg-[#38bdf8] text-slate-950'
                        : 'border-[#23303e] bg-[#0e1621] text-slate-200'
                  }`}
                >
                  {locked && <Lock className="w-3.5 h-3.5" />}
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-slate-300 block">اعضای دور میز (با کاما)</label>
          <input
            type="text"
            value={namesInput}
            onChange={(e) => setNamesInput(e.target.value)}
            className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] px-3.5 py-2.5 text-base sm:text-sm text-white"
          />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={createTruthDareRoom}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-3.5 text-sm font-bold text-slate-950 hover:bg-amber-300 min-h-[48px]"
        >
          <Play className="w-4 h-4" />
          <span>{busy ? 'در حال آماده‌سازی...' : 'شروع بازی بطری'}</span>
        </button>
      </div>
    );
  }

  // ==================== ACTIVE TABLE ====================
  const targetPlayer = activePlayers.find((p) => p.id === td.targetPlayerId) || null;
  const showChosenState = !isBottleAnimating && td.phase === 'CHOOSE_MODE' && targetPlayer;
  const showPromptState = !isBottleAnimating && td.phase === 'SHOW_PROMPT' && td.activePrompt;

  return (
    <div className="space-y-4 min-w-0">
      <div className="madar-glass rounded-2xl p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-300">
            دور <strong className="font-mono text-amber-300">{td.roundNumber}</strong> از {td.maxRounds}
          </span>
          <button
            type="button"
            onClick={() => onRoomChange(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#23303e] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white min-h-[34px]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>جدید</span>
          </button>
        </div>

        <div className="madar-scroll-x">
          <div className="inline-flex items-center gap-1.5">
            {TD_CATEGORIES.map((cat) => {
              const locked = Boolean(cat.adult && !isAdultVerified);
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    if (locked) {
                      onOpenAdultVerification?.();
                      return;
                    }
                    setSelectedCategory(cat.id);
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap shrink-0 min-h-[34px] ${
                    locked
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      : active
                        ? 'border-[#38bdf8] bg-[#38bdf8] text-slate-950'
                        : 'border-[#23303e] bg-[#0e1621] text-slate-300'
                  }`}
                >
                  {locked && <Lock className="w-3 h-3" />}
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
          {err}
        </div>
      )}

      {td.phase === 'FINISHED' ? (
        <div className="madar-glass rounded-3xl p-6 text-center space-y-4">
          <Trophy className="w-10 h-10 text-amber-400 mx-auto" />
          <h3 className="text-lg font-bold text-white">پایان بازی!</h3>
          <div className="max-w-sm mx-auto divide-y divide-[#23303e] text-right">
            {[...activePlayers]
              .sort((a, b) => b.score - a.score)
              .map((p, i) => (
                <div key={p.id} className="py-2 flex items-center justify-between text-xs">
                  <span className="text-slate-100 font-semibold">
                    {i + 1}. {p.name}
                  </span>
                  <span className="font-mono tabular-nums text-amber-300">{p.score} امتیاز</span>
                </div>
              ))}
          </div>
          <button
            type="button"
            onClick={createTruthDareRoom}
            className="rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-slate-950 min-h-[44px]"
          >
            دور جدید
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Circular Bottle Table */}
          <div className="lg:col-span-7 madar-glass rounded-3xl p-4 flex flex-col items-center space-y-4 overflow-hidden">
            <div className="relative w-full max-w-[340px] aspect-square mx-auto flex items-center justify-center">
              <div className="pointer-events-none absolute inset-[9%] rounded-full border border-[#23303e] bg-[#0e1621]/95" />
              <div className="pointer-events-none absolute inset-[22%] rounded-full border border-dashed border-[#38bdf8]/25" />

              {activePlayers.map((p, idx) => {
                const deg = (360 / activePlayers.length) * idx;
                const rad = ((deg - 90) * Math.PI) / 180;
                const x = 50 + Math.cos(rad) * 42;
                const y = 50 + Math.sin(rad) * 42;
                const isSelected = !isBottleAnimating && td.targetPlayerId === p.id;
                return (
                  <div
                    key={p.id}
                    style={{ left: `${x}%`, top: `${y}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center"
                  >
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 transition-all ${
                        isSelected ? 'border-amber-400 scale-115' : 'border-[#23303e]'
                      }`}
                      style={{ backgroundColor: p.avatarColor }}
                    >
                      {p.avatarInitials}
                    </div>
                    <span
                      className={`mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                        isSelected ? 'bg-amber-400 text-slate-950' : 'bg-[#0e1621]/95 text-slate-200'
                      }`}
                    >
                      {p.name}
                    </span>
                  </div>
                );
              })}

              <div className="relative z-10 flex items-center justify-center">
                <SpinBottle3D
                  targetAngleDeg={td.targetAngleDeg}
                  spinId={td.lastSpinId}
                  liteMode={liteMode}
                  onSpinComplete={() => setIsBottleAnimating(false)}
                />
              </div>
            </div>

            <div className="w-full flex flex-col items-center gap-2.5">
              <button
                type="button"
                disabled={busy || isBottleAnimating || td.phase !== 'READY_TO_SPIN'}
                onClick={handleSpinBottle}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-8 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50 min-h-[46px]"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isBottleAnimating ? 'در حال چرخش...' : 'بچرخان!'}</span>
              </button>

              <div className="flex items-center gap-1.5">
                {QUICK_REACTIONS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => handleReaction(em)}
                    className="w-9 h-9 rounded-xl border border-[#23303e] bg-[#0e1621] hover:border-amber-400/50 text-sm flex items-center justify-center active:scale-90"
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Prompt & Turn Panel */}
          <div className="lg:col-span-5 space-y-4">
            <div className="madar-glass-cyan rounded-3xl p-4 sm:p-5 space-y-4 min-h-[240px] flex flex-col justify-between">
              <AnimatePresence mode="wait">
                {isBottleAnimating ? (
                  <motion.div
                    key="spinning"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="my-auto text-center py-8"
                  >
                    <p className="text-sm font-bold text-[#38bdf8]">بطری در حال چرخش است...</p>
                  </motion.div>
                ) : showChosenState ? (
                  <motion.div
                    key="choose"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-4 text-center py-2"
                  >
                    <div className="inline-flex items-center gap-1 text-xs font-mono text-amber-300">
                      <Timer className="w-3.5 h-3.5" />
                      <span className="tabular-nums">{secondsLeft}s</span>
                    </div>
                    <div>
                      <p className="text-xs text-[#38bdf8]">نوبت</p>
                      <h3 className="text-xl font-bold text-white mt-0.5">{targetPlayer.name}</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleChooseMode('truth')}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8]/15 border border-[#38bdf8]/50 py-3.5 text-sm font-bold text-sky-100 hover:bg-[#38bdf8] hover:text-slate-950 transition-colors min-h-[48px]"
                      >
                        <HelpCircle className="w-4 h-4" />
                        <span>حقیقت</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleChooseMode('dare')}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-500/15 border border-rose-400/50 py-3.5 text-sm font-bold text-rose-100 hover:bg-rose-500 hover:text-white transition-colors min-h-[48px]"
                      >
                        <Flame className="w-4 h-4" />
                        <span>جرئت</span>
                      </button>
                    </div>
                  </motion.div>
                ) : showPromptState && td.activePrompt ? (
                  <motion.div
                    key={td.activePrompt.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={`font-bold px-2.5 py-1 rounded-lg ${
                          td.activePrompt.mode === 'truth'
                            ? 'bg-[#38bdf8]/15 text-[#38bdf8]'
                            : 'bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {td.activePrompt.mode === 'truth' ? 'حقیقت' : 'جرئت'} · {td.activePrompt.category}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums text-amber-300">
                        <Timer className="w-3.5 h-3.5" />
                        {secondsLeft}s
                      </span>
                    </div>

                    <div className="rounded-2xl border border-[#23303e] bg-[#0e1621] p-4">
                      <p className="text-sm sm:text-base font-medium text-white leading-relaxed">
                        {td.activePrompt.text}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResolve('completed')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-400 py-3 text-xs font-bold text-slate-950 min-h-[44px]"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>انجام شد</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResolve('skipped')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#23303e] bg-[#0e1621] py-3 text-xs font-semibold text-slate-200 min-h-[44px]"
                      >
                        <SkipForward className="w-4 h-4" />
                        <span>رد کردن</span>
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <div className="my-auto text-center py-8">
                    <p className="text-sm font-bold text-white">دکمه «بچرخان!» را بزن</p>
                  </div>
                )}
              </AnimatePresence>
            </div>

            {td.history.length > 0 && (
              <div className="madar-glass rounded-2xl p-3.5 space-y-2 max-h-40 overflow-y-auto madar-scroll-y">
                {td.history.slice(0, 5).map((h, i) => (
                  <div key={i} className="text-xs flex items-center justify-between gap-2 py-1 border-b border-[#23303e] last:border-0">
                    <span className="text-slate-200 truncate">
                      {h.playerName} ({h.mode})
                    </span>
                    <span className={h.outcome === 'completed' ? 'text-emerald-300 shrink-0' : 'text-slate-500 shrink-0'}>
                      {h.outcome === 'completed' ? 'انجام شد' : 'رد شد'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
