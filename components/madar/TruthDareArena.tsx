'use client';

import React, { useEffect, useState } from 'react';
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

const TD_CATEGORIES = [
  { id: 'دوستانه', label: 'دوستانه' },
  { id: 'خنده‌دار', label: 'خنده‌دار' },
  { id: 'چالشی', label: 'چالشی' },
  { id: 'احساسی', label: 'احساسی' },
  { id: 'عاشقانه', label: 'عاشقانه' },
  { id: 'بزرگسالان ۱۸+', label: 'بزرگسالان ۱۸+', adult: true },
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

  // Live countdown timer synced to backend turnDeadline
  useEffect(() => {
    if (!td?.turnDeadline) return;
    const update = () => {
      const rem = Math.max(0, Math.ceil((td.turnDeadline! - Date.now()) / 1000));
      setSecondsLeft(rem);
    };
    update();
    const t = setInterval(update, 500);
    return () => clearInterval(t);
  }, [td?.turnDeadline]);

  async function callEngine(payload: Record<string, unknown>) {
    if (!token) {
      setErr('برای شروع اتاق جرئت و حقیقت ابتدا وارد حساب مدار شوید.');
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
    if (selectedCategory === 'بزرگسالان ۱۸+' && !isAdultVerified) {
      setErr('حالت بزرگسالان ۱۸+ نیازمند تکمیل احراز چندلایه سن و رضایت در پروفایل است.');
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

  // ==================== STAGE 1: WAITING LOBBY ====================
  if (!td || !room) {
    return (
      <div className="madar-glass rounded-3xl p-5 sm:p-8 space-y-6">
        <div className="space-y-1.5 pb-4 border-b border-indigo-500/20">
          <p className="text-xs text-cyan-300">بطری شیشه‌ای سه‌بعدی · انتخاب کاملاً منصفانه سمت سرور</p>
          <h2 className="text-xl sm:text-2xl font-bold text-white">لابی دورهمی جرئت و حقیقت</h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            دور میز کیهانی بنشینید، بطری شیشه‌ای سه‌بعدی را بچرخانید و با ۶ حالت مختلف از دوستانه تا چالشی بازی کنید. همیشه امکان «رد کردن» بدون اجبار وجود دارد.
          </p>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {err}
          </div>
        )}

        {/* 6 Categories Scrollable Selector */}
        <div className="space-y-2">
          <p className="text-xs text-slate-300 font-semibold">انتخاب حال‌وهوای میز (۶ حالت):</p>
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
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 min-h-[44px] transition-colors ${
                      locked
                        ? 'border-rose-500/35 bg-rose-500/10 text-rose-300'
                        : active
                          ? 'border-amber-400 bg-amber-400 text-slate-950'
                          : 'border-indigo-500/30 bg-[#050816] text-slate-200 hover:border-cyan-400/50'
                    }`}
                  >
                    {locked && <Lock className="w-3.5 h-3.5" />}
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-slate-300 block">هم‌تیمی‌ها و اعضای دور میز (۲ تا ۷ نفر علاوه بر شما، با کاما):</label>
          <input
            type="text"
            value={namesInput}
            onChange={(e) => setNamesInput(e.target.value)}
            className="w-full rounded-xl border border-indigo-500/30 bg-[#050816] px-3.5 py-2.5 text-base sm:text-sm text-white"
          />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={createTruthDareRoom}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-cyan-400 to-purple-500 px-7 py-3 text-sm font-bold text-slate-950 hover:brightness-110 min-h-[48px]"
        >
          <Play className="w-4 h-4" />
          <span>{busy ? 'در حال آماده‌سازی میز...' : 'نشستن دور میز بطری سه‌بعدی'}</span>
        </button>
      </div>
    );
  }

  // ==================== STAGE 2 & 3: CIRCULAR GATHERING TABLE ====================
  const targetPlayer = activePlayers.find((p) => p.id === td.targetPlayerId) || null;
  const showChosenState = !isBottleAnimating && td.phase === 'CHOOSE_MODE' && targetPlayer;
  const showPromptState = !isBottleAnimating && td.phase === 'SHOW_PROMPT' && td.activePrompt;

  return (
    <div className="space-y-5 min-w-0">
      {/* Top Status Strip + Mode Switcher */}
      <div className="madar-glass rounded-2xl p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono font-bold text-cyan-300">{room.roomCode}</span>
            <span className="text-slate-300">
              دور <strong className="font-mono tabular-nums text-amber-300">{td.roundNumber}</strong> از {td.maxRounds}
            </span>
            <span className="text-slate-300">حالت: <strong className="text-purple-200">{selectedCategory}</strong></span>
          </div>
          <button
            type="button"
            onClick={() => onRoomChange(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white min-h-[36px]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>خروج از اتاق</span>
          </button>
        </div>

        {/* Live 6-mode touch-safe ribbon */}
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
                  className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap shrink-0 min-h-[36px] ${
                    locked
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      : active
                        ? 'border-amber-400 bg-amber-400 text-slate-950'
                        : 'border-indigo-500/25 bg-[#050816] text-slate-300'
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
        <div className="madar-glass rounded-3xl p-8 text-center space-y-4">
          <Trophy className="w-11 h-11 text-amber-400 mx-auto" />
          <h3 className="text-xl font-bold text-white">پایان دورهمی جرئت و حقیقت!</h3>
          <p className="text-sm text-slate-300">همه {td.maxRounds} دور با موفقیت انجام شد و پاداش ستاره ثبت گردید.</p>
          <div className="max-w-md mx-auto divide-y divide-indigo-500/20 text-right">
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
            className="rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 min-h-[46px]"
          >
            شروع دورهمی جدید
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Circular Cosmic Gathering Table + 3D Glass Bottle */}
          <div className="lg:col-span-7 madar-glass rounded-3xl p-4 sm:p-6 flex flex-col items-center space-y-5 relative overflow-hidden">
            <div className="relative w-full max-w-[390px] aspect-square mx-auto flex items-center justify-center">
              {/* Outer Cosmic Table Ring */}
              <div className="pointer-events-none absolute inset-[9%] rounded-full border-2 border-cyan-400/30 bg-[radial-gradient(circle_at_center,rgba(30,27,75,0.68),rgba(5,8,22,0.96))] shadow-[0_0_55px_rgba(56,189,248,0.16)]" />
              <div className="pointer-events-none absolute inset-[22%] rounded-full border border-dashed border-purple-400/35" />

              {/* Players Seated Mathematically Around Circle (0 deg = top/12 o'clock, clockwise) */}
              {activePlayers.map((p, idx) => {
                const deg = (360 / activePlayers.length) * idx;
                const rad = ((deg - 90) * Math.PI) / 180;
                const radiusPct = 42;
                const x = 50 + Math.cos(rad) * radiusPct;
                const y = 50 + Math.sin(rad) * radiusPct;
                const isSelected = !isBottleAnimating && td.targetPlayerId === p.id;
                return (
                  <div
                    key={p.id}
                    style={{ left: `${x}%`, top: `${y}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center"
                  >
                    <div
                      className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 transition-all duration-300 ${
                        isSelected
                          ? 'border-amber-400 scale-115 shadow-[0_0_24px_rgba(245,158,11,0.75)]'
                          : 'border-cyan-400/40'
                      }`}
                      style={{ backgroundColor: p.avatarColor }}
                    >
                      {p.avatarInitials}
                    </div>
                    <span
                      className={`mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                        isSelected ? 'bg-amber-400 text-slate-950' : 'bg-[#050816]/90 text-slate-200'
                      }`}
                    >
                      {p.name}
                    </span>
                  </div>
                );
              })}

              {/* Center 3D Glass Bottle */}
              <div className="relative z-10 flex items-center justify-center">
                <SpinBottle3D
                  targetAngleDeg={td.targetAngleDeg}
                  spinId={td.lastSpinId}
                  liteMode={liteMode}
                  onSpinComplete={() => setIsBottleAnimating(false)}
                />
              </div>
            </div>

            {/* Spin CTA */}
            <div className="w-full flex flex-col items-center gap-2">
              <button
                type="button"
                disabled={busy || isBottleAnimating || td.phase === 'SHOW_PROMPT'}
                onClick={handleSpinBottle}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-amber-400 to-amber-300 px-8 py-3.5 text-sm font-bold text-slate-950 hover:brightness-105 disabled:opacity-50 min-h-[48px] shadow-lg shadow-amber-500/20"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isBottleAnimating ? 'بطری در حال چرخش است...' : 'بچرخان! (انتخاب امن سرور)'}</span>
              </button>

              {/* Floating Reactions Bar */}
              <div className="flex items-center gap-1.5 pt-1">
                {QUICK_REACTIONS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => handleReaction(em)}
                    className="w-10 h-10 rounded-xl border border-indigo-500/25 bg-[#050816] hover:border-amber-400/50 text-base flex items-center justify-center transition-transform active:scale-90"
                  >
                    {em}
                  </button>
                ))}
              </div>
              {td.reactions.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 text-[11px] text-slate-400">
                  {td.reactions.slice(0, 3).map((r) => (
                    <span key={r.id}>
                      {r.emoji} {r.from}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Turn Action, Prompt Card, Timer & History */}
          <div className="lg:col-span-5 space-y-4">
            <div className="madar-glass-cyan rounded-3xl p-5 space-y-4 min-h-[260px] flex flex-col justify-between">
              <AnimatePresence mode="wait">
                {isBottleAnimating ? (
                  <motion.div
                    key="spinning"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="my-auto text-center py-8 space-y-2"
                  >
                    <p className="text-base font-bold text-cyan-200">بطری در حال چرخش است...</p>
                    <p className="text-xs text-slate-400">نفر انتخاب‌شده توسط موتور رمزنگاری‌شده مدار تعیین شد</p>
                  </motion.div>
                ) : showChosenState ? (
                  <motion.div
                    key="choose"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-4 text-center py-3"
                  >
                    <div className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-300">
                      <Timer className="w-4 h-4" />
                      <span className="tabular-nums">{secondsLeft} ثانیه</span>
                    </div>
                    <div>
                      <p className="text-xs text-cyan-300">بطری ایستاد روی:</p>
                      <h3 className="text-2xl font-bold text-white mt-1">{targetPlayer.name}</h3>
                    </div>
                    <p className="text-xs text-slate-300">حقیقت یا جرئت را انتخاب کن:</p>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleChooseMode('truth')}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500/20 border border-sky-400/50 py-3.5 text-sm font-bold text-sky-100 hover:bg-sky-400 hover:text-slate-950 transition-colors min-h-[48px]"
                      >
                        <HelpCircle className="w-4 h-4" />
                        <span>حقیقت</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleChooseMode('dare')}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-500/20 border border-rose-400/50 py-3.5 text-sm font-bold text-rose-100 hover:bg-rose-500 hover:text-white transition-colors min-h-[48px]"
                      >
                        <Flame className="w-4 h-4" />
                        <span>جرئت</span>
                      </button>
                    </div>
                  </motion.div>
                ) : showPromptState && td.activePrompt ? (
                  <motion.div
                    key={td.activePrompt.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-amber-300">
                        {td.activePrompt.mode === 'truth' ? 'حقیقت' : 'جرئت'} · {targetPlayer?.name}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums text-cyan-300">
                        <Timer className="w-3.5 h-3.5" />
                        {secondsLeft}s
                      </span>
                    </div>

                    <div className="rounded-2xl border border-indigo-400/30 bg-[#050816] p-5">
                      <p className="text-base sm:text-lg font-medium text-white leading-relaxed">
                        {td.activePrompt.text}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResolve('completed')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-400 py-3 text-xs sm:text-sm font-bold text-slate-950 hover:bg-emerald-300 min-h-[46px]"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>انجام شد (+۳۰)</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResolve('skipped')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-[#050816] py-3 text-xs sm:text-sm font-semibold text-slate-200 hover:border-amber-400 min-h-[46px]"
                      >
                        <SkipForward className="w-4 h-4" />
                        <span>رد کردن (آزاد)</span>
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <div className="my-auto text-center py-8 space-y-2">
                    <p className="text-sm font-bold text-white">آماده برای چرخش بطری</p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      دکمه «بچرخان» را بزن تا بطری سه‌بعدی با فیزیک واقعی بچرخد و نفر بعدی را مشخص کند.
                    </p>
                  </div>
                )}
              </AnimatePresence>
            </div>

            {/* Round History */}
            <div className="madar-glass rounded-2xl p-4 space-y-2.5">
              <p className="text-xs font-bold text-slate-300">تاریخچه دورهای این میز ({td.history.length})</p>
              {td.history.length === 0 ? (
                <p className="text-xs text-slate-500">هنوز دوری ثبت نشده است.</p>
              ) : (
                <div className="space-y-2 max-h-44 overflow-y-auto madar-scroll-y">
                  {td.history.slice(0, 6).map((h, i) => (
                    <div key={i} className="rounded-xl bg-[#050816] border border-indigo-500/15 p-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">
                          دور {h.round} · {h.playerName} ({h.mode})
                        </span>
                        <span className={h.outcome === 'completed' ? 'text-emerald-300' : 'text-slate-400'}>
                          {h.outcome === 'completed' ? 'انجام شد' : 'رد شد'}
                        </span>
                      </div>
                      <p className="text-slate-400 line-clamp-2">{h.promptText}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
