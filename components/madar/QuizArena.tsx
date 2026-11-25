'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Flame, Play, RotateCcw, Trophy, XCircle, Zap } from 'lucide-react';
import { triggerHaptic, triggerHapticNotice } from '@/lib/telegram-webapp';
import { madarSound } from './SoundFX';
import type { SanitizedEngineRoom } from './types';

interface QuizArenaProps {
  token: string | null;
  room: SanitizedEngineRoom | null;
  liteMode: boolean;
  onRoomChange: (room: SanitizedEngineRoom | null) => void;
  onRewardNotice: (msg: string) => void;
  onRefreshUser: () => Promise<void>;
}

const QUIZ_CATEGORIES = ['همه', 'اطلاعات عمومی', 'نجوم و فضا', 'فرهنگ و سینما', 'فناوری'];

export default function QuizArena({
  token,
  room,
  liteMode,
  onRoomChange,
  onRewardNotice,
  onRefreshUser,
}: QuizArenaProps) {
  const [category, setCategory] = useState('همه');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(18);

  const qz = room?.gameType === 'quiz' ? room.quiz : undefined;

  async function callEngine(payload: Record<string, unknown>) {
    if (!token) {
      setErr('برای شرکت در مسابقه کوییز زنده ابتدا وارد حساب مدار شوید.');
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
        setErr(data.error || 'خطا در اجرای مسابقه کوییز');
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

  // Graphical countdown synced to server questionStartedAt
  useEffect(() => {
    if (!qz || qz.phase !== 'QUESTION' || !room) return;
    const tick = () => {
      const elapsed = (Date.now() - qz.questionStartedAt) / 1000;
      const rem = Math.max(0, Math.ceil(qz.questionDurationSec - elapsed));
      setSecondsLeft(rem);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [qz, room]);

  async function startQuizRoom() {
    madarSound.playClick();
    triggerHaptic('medium');
    await callEngine({ action: 'create_room', gameType: 'quiz', category });
  }

  async function submitAnswer(idx: number) {
    if (!room || !qz || qz.phase !== 'QUESTION' || busy) return;
    triggerHaptic('light');
    const updated = await callEngine({
      action: 'quiz_answer',
      roomCode: room.roomCode,
      selectedIndex: idx,
    });
    const last = updated?.quiz?.lastAnswer;
    if (last) {
      if (last.isCorrect) madarSound.playCorrect();
      else madarSound.playWrong();
    }
  }

  async function nextQuestion() {
    if (!room) return;
    madarSound.playClick();
    await callEngine({ action: 'quiz_next', roomCode: room.roomCode });
  }

  // ==================== LOBBY ====================
  if (!qz || !room) {
    return (
      <div className="madar-glass rounded-3xl p-5 sm:p-8 space-y-6">
        <div className="space-y-1.5 pb-4 border-b border-indigo-500/20">
          <p className="text-xs text-sky-300">بررسی ضدتقلب سمت سرور · رقابت زنده سرعت و دقت</p>
          <h2 className="text-xl sm:text-2xl font-bold text-white">لابی لیگ کوییز عطارد</h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            پاسخ صحیح تا پیش از ثبت انتخاب شما در سرور مخفی می‌ماند. هر پاسخ سریع و متوالی (Streak) امتیاز اضافه دارد!
          </p>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {err}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs text-slate-300 font-semibold">انتخاب موضوع مسابقه:</p>
          <div className="madar-scroll-x">
            <div className="inline-flex items-center gap-2 py-1">
              {QUIZ_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-xl border px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 min-h-[42px] ${
                    category === c
                      ? 'border-cyan-400 bg-cyan-400 text-slate-950'
                      : 'border-indigo-500/25 bg-[#050816] text-slate-200'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={startQuizRoom}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-sky-400 to-cyan-400 px-7 py-3 text-sm font-bold text-slate-950 hover:brightness-110 min-h-[48px]"
        >
          <Play className="w-4 h-4" />
          <span>{busy ? 'در حال شروع لیگ...' : 'شروع مسابقه زنده کوییز'}</span>
        </button>
      </div>
    );
  }

  const me = room.players[0];
  const myScore = me?.score ?? 0;
  const raceList = [
    { id: 'me', name: `${me?.name || 'شما'} (شما)`, avatarInitials: me?.avatarInitials || 'شم', avatarColor: '#f59e0b', score: myScore, isMe: true },
    ...qz.rivals.map((r) => ({ ...r, isMe: false })),
  ].sort((a, b) => b.score - a.score);

  const progressPct = qz.totalQuestions > 0 ? Math.round(((qz.currentIndex + 1) / qz.totalQuestions) * 100) : 100;
  const ringRadius = 22;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - secondsLeft / Math.max(1, qz.questionDurationSec));

  // ==================== FINISHED RESULT SCREEN ====================
  if (qz.phase === 'FINISHED') {
    const myRank = raceList.findIndex((r) => r.isMe) + 1;
    return (
      <div className="madar-glass rounded-3xl p-6 sm:p-8 text-center space-y-6">
        <Trophy className={`w-12 h-12 mx-auto ${myRank === 1 ? 'text-amber-400' : 'text-cyan-300'}`} />
        <div className="space-y-1">
          <h3 className="text-2xl font-bold text-white">
            {myRank === 1 ? 'رتبه اول لیگ عطارد!' : `پایان مسابقه در رتبه ${myRank}`}
          </h3>
          <p className="text-sm text-slate-300">
            پاسخ صحیح: <strong className="font-mono text-emerald-300">{qz.correctCount}</strong> از {qz.totalQuestions} · امتیاز کل:{' '}
            <strong className="font-mono tabular-nums text-amber-300">{myScore}</strong>
          </p>
        </div>

        <div className="max-w-md mx-auto space-y-2 text-right">
          {raceList.map((r, i) => (
            <div
              key={r.id}
              className={`rounded-xl border px-4 py-2.5 flex items-center justify-between text-xs ${
                r.isMe ? 'border-amber-400/50 bg-amber-400/10 text-white font-bold' : 'border-indigo-500/20 bg-[#050816] text-slate-300'
              }`}
            >
              <span>
                #{i + 1} · {r.name}
              </span>
              <span className="font-mono tabular-nums text-amber-300">{r.score}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={startQuizRoom}
            className="rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 min-h-[46px]"
          >
            مسابقه جدید
          </button>
          <button
            type="button"
            onClick={() => onRoomChange(null)}
            className="rounded-xl border border-slate-700 px-5 py-3 text-sm text-slate-200 min-h-[46px]"
          >
            بازگشت به لابی
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Main Question Stage */}
      <div className="lg:col-span-8 madar-glass-cyan rounded-3xl p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>
                سؤال <strong className="font-mono text-white">{qz.currentIndex + 1}</strong> از {qz.totalQuestions} ·{' '}
                <span className="text-cyan-300">{qz.currentQuestion?.category}</span>
              </span>
              {qz.streak > 1 && (
                <span className="inline-flex items-center gap-1 text-amber-300 font-bold">
                  <Flame className="w-3.5 h-3.5" />
                  رگبار {qz.streak}×
                </span>
              )}
            </div>
            <div className="h-1.5 rounded-full bg-slate-900 overflow-hidden">
              <div
                className="h-full bg-gradient-to-l from-cyan-400 to-purple-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Graphical SVG Countdown Ring */}
          <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
              <circle cx="28" cy="28" r={ringRadius} fill="none" stroke="#1e293b" strokeWidth="4" />
              <circle
                cx="28"
                cy="28"
                r={ringRadius}
                fill="none"
                stroke={secondsLeft <= 5 ? '#f43f5e' : '#22d3ee'}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                className="transition-all duration-200"
              />
            </svg>
            <span className="absolute font-mono tabular-nums text-xs font-bold text-white">{secondsLeft}</span>
          </div>
        </div>

        {qz.currentQuestion && (
          <motion.div
            key={qz.currentQuestion.id}
            initial={liteMode ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <h3 className="text-base sm:text-xl font-bold text-white leading-relaxed">
              {qz.currentQuestion.question}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {qz.currentQuestion.options.map((opt, idx) => {
                const revealed = qz.phase === 'REVEAL' && qz.lastAnswer;
                const isCorrectOpt = revealed && qz.lastAnswer!.correctIndex === idx;
                const isWrongPick = revealed && qz.lastAnswer!.selectedIndex === idx && !qz.lastAnswer!.isCorrect;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={busy || qz.phase !== 'QUESTION'}
                    onClick={() => submitAnswer(idx)}
                    className={`rounded-2xl border p-4 text-right text-sm font-medium transition-all min-h-[54px] flex items-center justify-between gap-2 ${
                      isCorrectOpt
                        ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                        : isWrongPick
                          ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                          : 'border-indigo-500/30 bg-[#050816] text-slate-100 hover:border-cyan-400 hover:bg-cyan-400/10'
                    }`}
                  >
                    <span>{opt}</span>
                    {isCorrectOpt && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
                    {isWrongPick && <XCircle className="w-5 h-5 text-rose-400 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {qz.phase === 'REVEAL' && qz.lastAnswer && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-cyan-500/20">
                <div className="text-xs sm:text-sm font-semibold">
                  {qz.lastAnswer.isCorrect ? (
                    <span className="text-emerald-300">
                      پاسخ درست! +{qz.lastAnswer.pointsGained} امتیاز سرعت و دقت
                    </span>
                  ) : (
                    <span className="text-rose-300">پاسخ نادرست بود — در سؤال بعدی جبران کن!</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={nextQuestion}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-5 py-2.5 text-xs sm:text-sm font-bold text-slate-950 hover:bg-amber-300 min-h-[44px]"
                >
                  <Zap className="w-4 h-4" />
                  <span>{qz.currentIndex + 1 >= qz.totalQuestions ? 'مشاهده نتیجه نهایی' : 'سؤال بعدی'}</span>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Live Rival Race Rail */}
      <aside className="lg:col-span-4 madar-glass rounded-3xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-white">رقابت زنده اتاق</h4>
          <button
            type="button"
            onClick={() => onRoomChange(null)}
            className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span>خروج</span>
          </button>
        </div>

        <div className="space-y-2.5">
          {raceList.map((r, i) => {
            const maxVal = Math.max(raceList[0]?.score || 1, 200);
            const barPct = Math.min(100, Math.round((r.score / maxVal) * 100));
            return (
              <div key={r.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className={r.isMe ? 'text-amber-300 font-bold' : 'text-slate-200'}>
                    {i + 1}. {r.name}
                  </span>
                  <span className="font-mono tabular-nums text-cyan-300">{r.score}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-900 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      r.isMe ? 'bg-amber-400' : 'bg-purple-500/80'
                    }`}
                    style={{ width: `${Math.max(8, barPct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
