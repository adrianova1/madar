'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Crown, Play, RotateCcw, Sparkles, Trophy, Users } from 'lucide-react';
import { isCardPlayable, SEAT_LABELS, SUIT_META, type Suit } from '@/lib/hokm-engine';
import { triggerHaptic, triggerHapticNotice } from '@/lib/telegram-webapp';
import PlayingCardSVG, { PlayingCardBackSVG } from './PlayingCardSVG';
import { madarSound } from './SoundFX';
import type { SanitizedEngineRoom } from './types';

interface HokmArenaProps {
  token: string | null;
  room: SanitizedEngineRoom | null;
  liteMode: boolean;
  onRoomChange: (room: SanitizedEngineRoom | null) => void;
  onRewardNotice: (msg: string) => void;
  onRefreshUser: () => Promise<void>;
}

const SUIT_LIST: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

export default function HokmArena({
  token,
  room,
  liteMode,
  onRoomChange,
  onRewardNotice,
  onRefreshUser,
}: HokmArenaProps) {
  const [targetHands, setTargetHands] = useState(3);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hokm = room?.gameType === 'hokm' ? room.hokm : undefined;

  // Smart polling when inside an active Hokm room
  useEffect(() => {
    if (!room || room.gameType !== 'hokm' || !token) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/games/engine?roomCode=${encodeURIComponent(room.roomCode)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.room) onRoomChange(data.room);
        }
      } catch {
        // Ignore transient disconnect, next poll recovers cleanly
      }
    }, 6000);
    return () => clearInterval(id);
  }, [room, token, onRoomChange]);

  async function callEngine(payload: Record<string, unknown>) {
    if (!token) {
      setErr('برای شروع مسابقه حکم ابتدا وارد حساب مدار شوید.');
      return;
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
        setErr(data.error || 'خطا در اجرای دستور حکم');
        return;
      }
      if (data.room) onRoomChange(data.room);
      if (data.message) {
        onRewardNotice(data.message);
        madarSound.playWinFanfare();
        triggerHapticNotice('success');
        await onRefreshUser();
      }
    } finally {
      setBusy(false);
    }
  }

  async function createHokmRoom() {
    madarSound.playCardSnap();
    triggerHaptic('medium');
    await callEngine({ action: 'create_room', gameType: 'hokm', hokmTargetHands: targetHands });
  }

  async function joinExistingRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    await callEngine({ action: 'join_room', roomCode: joinCode.trim() });
  }

  async function handleChooseSuit(suit: Suit) {
    if (!room) return;
    madarSound.playCardSnap();
    triggerHaptic('medium');
    await callEngine({ action: 'hokm_choose_trump', roomCode: room.roomCode, suit });
  }

  async function handlePlayCard(cardId: string) {
    if (!room) return;
    madarSound.playCardSnap();
    triggerHaptic('light');
    await callEngine({ action: 'hokm_play_card', roomCode: room.roomCode, cardId });
  }

  async function handleNextHand() {
    if (!room) return;
    madarSound.playCardSnap();
    await callEngine({ action: 'hokm_next_hand', roomCode: room.roomCode });
  }

  // ==================== STAGE 1: WAITING LOBBY ====================
  if (!hokm || !room) {
    return (
      <div className="madar-glass rounded-3xl p-5 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-indigo-500/20">
          <div className="space-y-1">
            <p className="text-xs text-amber-300">موتور مرکزی سرورمحور · کارت‌های واقعی پاسور</p>
            <h2 className="text-xl sm:text-2xl font-bold text-white">لابی حکم چهارنفره مدار</h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              توزیع امن کارت‌ها در سرور، رعایت دقیق خال زمینه، محاسبه کوت و پاداش ستاره پس از پایان مسابقه.
            </p>
          </div>
          {/* Preview Fan of Luxury Cards */}
          <div className="flex items-center justify-center -space-x-5 space-x-reverse shrink-0 py-1">
            <div className="-rotate-12">
              <PlayingCardSVG suit="spades" rank={14} size="xs" isTrump />
            </div>
            <div className="-rotate-4">
              <PlayingCardSVG suit="hearts" rank={13} size="xs" />
            </div>
            <div className="rotate-6">
              <PlayingCardSVG suit="diamonds" rank={12} size="xs" />
            </div>
            <div className="rotate-12">
              <PlayingCardBackSVG size="xs" />
            </div>
          </div>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {err}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-2xl border border-indigo-500/25 bg-[#050816] p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Crown className="w-4 h-4 text-amber-400" />
              <span>ساخت میز جدید (تکمیل خودکار با یار و حریف هوشمند)</span>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-slate-400">تعداد دست برای قهرمانی:</p>
              <div className="grid grid-cols-3 gap-2">
                {[3, 5, 7].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTargetHands(n)}
                    className={`rounded-xl border py-2.5 text-xs font-bold min-h-[44px] transition-colors ${
                      targetHands === n
                        ? 'border-amber-400 bg-amber-400/15 text-amber-200'
                        : 'border-slate-800 bg-[#0a1026] text-slate-300'
                    }`}
                  >
                    {n} دست
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={createHokmRoom}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60 min-h-[48px]"
            >
              <Play className="w-4 h-4" />
              <span>{busy ? 'در حال پخش کارت‌ها...' : 'شروع میز حکم چهارنفره'}</span>
            </button>
          </div>

          <form onSubmit={joinExistingRoom} className="rounded-2xl border border-indigo-500/25 bg-[#050816] p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Users className="w-4 h-4 text-cyan-400" />
                <span>پیوستن به میز دوست با کد اتاق</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                اگر دوستت میز حکم یا دورهمی ساخته، کد اتاق (مثلاً MDR-4821) را وارد کن تا روی میز بنشینی.
              </p>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="MDR-1234"
                className="w-full rounded-xl border border-indigo-500/30 bg-[#0a1026] px-3.5 py-2.5 text-base sm:text-sm font-mono text-white dir-ltr text-left"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !joinCode.trim()}
              className="w-full rounded-xl border border-cyan-400/45 bg-cyan-400/10 py-3 text-sm font-semibold text-cyan-200 hover:bg-cyan-400 hover:text-slate-950 disabled:opacity-50 min-h-[48px]"
            >
              ورود به اتاق حکم
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==================== STAGE 2 & 3: ACTIVE 4-PLAYER TABLE & RESULT ====================
  const myHand = hokm.hands[0] || [];
  const trickBySeat = new Map<number, (typeof hokm.currentTrick)[number]>();
  for (const t of hokm.currentTrick) trickBySeat.set(t.seat, t);

  const trumpMeta = hokm.hokm ? SUIT_META[hokm.hokm] : null;
  const userWonMatch = hokm.matchScore[0] > hokm.matchScore[1];

  return (
    <div className="space-y-4 min-w-0">
      {/* Compact Score & Room HUD */}
      <div className="madar-glass rounded-2xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm">
          <span className="font-mono text-cyan-300 font-bold">{room.roomCode}</span>
          <span className="text-slate-300">
            تیم شما: <strong className="font-mono tabular-nums text-emerald-300">{hokm.matchScore[0]}</strong>
            <span className="text-slate-500 mx-1">/</span>
            حریف: <strong className="font-mono tabular-nums text-rose-300">{hokm.matchScore[1]}</strong>
          </span>
          <span className="text-slate-300">
            دست فعلی: <strong className="font-mono tabular-nums text-white">{hokm.tricksWon[0]}</strong> -{' '}
            <strong className="font-mono tabular-nums text-white">{hokm.tricksWon[1]}</strong>
          </span>
          {trumpMeta && (
            <span className="font-bold text-amber-300">
              حکم: {trumpMeta.symbol} {trumpMeta.fa}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onRoomChange(null)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:text-white min-h-[38px]"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>خروج از میز</span>
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
          {err}
        </div>
      )}

      {/* Luxury 4-Player Cosmic Card Table */}
      <div className="madar-card-table rounded-3xl border border-cyan-400/25 p-4 sm:p-6 space-y-5 relative overflow-hidden">
        {/* Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-[#050816]/80 border border-cyan-500/20 rounded-xl px-3.5 py-2.5">
          <span className="text-cyan-100 font-medium">{hokm.lastEvent}</span>
          <span className="text-amber-300 font-semibold">
            حاکم: {SEAT_LABELS[hokm.hakem]} · نوبت: {SEAT_LABELS[hokm.turn]}
          </span>
        </div>

        {/* North Seat (Partner — Seat 2) */}
        <div className="flex flex-col items-center gap-1.5">
          <span className={`text-xs font-semibold ${hokm.turn === 2 ? 'text-amber-300' : 'text-slate-300'}`}>
            {room.players[2]?.name || 'یار شما'} ({hokm.handCounts[2]} کارت)
          </span>
          <div className="flex items-center justify-center -space-x-6 space-x-reverse">
            {Array.from({ length: Math.min(5, hokm.handCounts[2]) }).map((_, i) => (
              <PlayingCardBackSVG key={i} size="xs" className="opacity-85" />
            ))}
          </div>
        </div>

        {/* Middle Row: West Opponent (Seat 3) + Center Trick Felt + East Opponent (Seat 1) */}
        <div className="grid grid-cols-12 items-center gap-2 sm:gap-4 min-h-[210px] sm:min-h-[250px]">
          {/* East Opponent (Seat 1 in RTL visual right) */}
          <div className="col-span-3 flex flex-col items-center gap-2">
            <span className={`text-[11px] sm:text-xs font-semibold text-center ${hokm.turn === 1 ? 'text-amber-300' : 'text-slate-400'}`}>
              {room.players[1]?.name || 'حریف ۱'} ({hokm.handCounts[1]})
            </span>
            <div className="hidden sm:flex -space-x-8 space-x-reverse">
              {Array.from({ length: Math.min(3, hokm.handCounts[1]) }).map((_, i) => (
                <PlayingCardBackSVG key={i} size="xs" className="opacity-75" />
              ))}
            </div>
          </div>

          {/* Center Trick Arena */}
          <div className="col-span-6 relative flex flex-col items-center justify-center min-h-[190px] sm:min-h-[230px] rounded-2xl border border-cyan-400/20 bg-[#050a1b]/75 p-3">
            {hokm.phase === 'CHOOSE_HOKM' ? (
              <div className="text-center space-y-3 w-full">
                <p className="text-xs sm:text-sm font-bold text-amber-300">شما حاکم هستید! خال حکم را انتخاب کنید:</p>
                <div className="grid grid-cols-2 gap-2">
                  {SUIT_LIST.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => handleChooseSuit(s)}
                      className="rounded-xl border border-amber-400/40 bg-[#0b122c] hover:bg-amber-400 hover:text-slate-950 py-2.5 px-3 text-sm font-bold transition-colors min-h-[46px] flex items-center justify-center gap-1.5"
                    >
                      <span className={s === 'hearts' || s === 'diamonds' ? 'text-rose-400' : 'text-cyan-200'}>
                        {SUIT_META[s].symbol}
                      </span>
                      <span>{SUIT_META[s].fa}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : hokm.phase === 'HAND_OVER' ? (
              <div className="text-center space-y-3">
                <Sparkles className="w-7 h-7 text-amber-400 mx-auto" />
                <p className="text-sm font-bold text-white">پایان دست {hokm.roundNumber}</p>
                <p className="text-xs text-slate-300">
                  امتیاز دست: شما {hokm.tricksWon[0]} — حریف {hokm.tricksWon[1]}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleNextHand}
                  className="rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-300 min-h-[44px]"
                >
                  پخش دست بعدی
                </button>
              </div>
            ) : hokm.phase === 'MATCH_OVER' ? (
              <div className="text-center space-y-3">
                <Trophy className={`w-9 h-9 mx-auto ${userWonMatch ? 'text-amber-400' : 'text-slate-400'}`} />
                <p className="text-base font-bold text-white">
                  {userWonMatch ? 'قهرمانی تیم شما در حکم!' : 'پایان مسابقه حکم'}
                </p>
                <p className="text-xs font-mono tabular-nums text-cyan-200">
                  نتیجه نهایی: {hokm.matchScore[0]} - {hokm.matchScore[1]}
                </p>
                <button
                  type="button"
                  onClick={createHokmRoom}
                  className="rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-300 min-h-[44px]"
                >
                  مسابقه جدید
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 grid-rows-3 items-center justify-items-center w-full h-full gap-1">
                {/* Seat 2 (Top) */}
                <div className="col-start-2 row-start-1">
                  <AnimatePresence>
                    {trickBySeat.has(2) && (
                      <motion.div
                        key={trickBySeat.get(2)!.card.id}
                        initial={liteMode ? false : { opacity: 0, y: -22, scale: 0.85 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                      >
                        <PlayingCardSVG
                          suit={trickBySeat.get(2)!.card.suit}
                          rank={trickBySeat.get(2)!.card.rank}
                          size="xs"
                          isTrump={trickBySeat.get(2)!.card.suit === hokm.hokm}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Seat 1 (Right in RTL) */}
                <div className="col-start-1 row-start-2">
                  <AnimatePresence>
                    {trickBySeat.has(1) && (
                      <motion.div
                        key={trickBySeat.get(1)!.card.id}
                        initial={liteMode ? false : { opacity: 0, x: 22, scale: 0.85 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                      >
                        <PlayingCardSVG
                          suit={trickBySeat.get(1)!.card.suit}
                          rank={trickBySeat.get(1)!.card.rank}
                          size="xs"
                          isTrump={trickBySeat.get(1)!.card.suit === hokm.hokm}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Center Emblem */}
                <div className="col-start-2 row-start-2 text-center">
                  {hokm.currentTrick.length === 0 && (
                    <span className="text-[11px] text-cyan-200/70">نوبت بازی کارت</span>
                  )}
                </div>

                {/* Seat 3 (Left in RTL) */}
                <div className="col-start-3 row-start-2">
                  <AnimatePresence>
                    {trickBySeat.has(3) && (
                      <motion.div
                        key={trickBySeat.get(3)!.card.id}
                        initial={liteMode ? false : { opacity: 0, x: -22, scale: 0.85 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                      >
                        <PlayingCardSVG
                          suit={trickBySeat.get(3)!.card.suit}
                          rank={trickBySeat.get(3)!.card.rank}
                          size="xs"
                          isTrump={trickBySeat.get(3)!.card.suit === hokm.hokm}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Seat 0 (Bottom — You) */}
                <div className="col-start-2 row-start-3">
                  <AnimatePresence>
                    {trickBySeat.has(0) && (
                      <motion.div
                        key={trickBySeat.get(0)!.card.id}
                        initial={liteMode ? false : { opacity: 0, y: 24, scale: 0.85 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                      >
                        <PlayingCardSVG
                          suit={trickBySeat.get(0)!.card.suit}
                          rank={trickBySeat.get(0)!.card.rank}
                          size="xs"
                          isTrump={trickBySeat.get(0)!.card.suit === hokm.hokm}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>

          {/* West Opponent (Seat 3) */}
          <div className="col-span-3 flex flex-col items-center gap-2">
            <span className={`text-[11px] sm:text-xs font-semibold text-center ${hokm.turn === 3 ? 'text-amber-300' : 'text-slate-400'}`}>
              {room.players[3]?.name || 'حریف ۲'} ({hokm.handCounts[3]})
            </span>
            <div className="hidden sm:flex -space-x-8 space-x-reverse">
              {Array.from({ length: Math.min(3, hokm.handCounts[3]) }).map((_, i) => (
                <PlayingCardBackSVG key={i} size="xs" className="opacity-75" />
              ))}
            </div>
          </div>
        </div>

        {/* South Seat — Your Playable Luxury SVG Hand (Touch-safe horizontal scroll on small phones) */}
        <div className="space-y-2 pt-2 border-t border-cyan-500/20">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">
              دست شما ({myHand.length} کارت)
            </span>
            <span className={hokm.turn === 0 && hokm.phase === 'PLAYING' ? 'text-emerald-300 font-semibold' : 'text-slate-400'}>
              {hokm.phase === 'CHOOSE_HOKM'
                ? '۵ کارت اولیه برای انتخاب حکم'
                : hokm.turn === 0 && hokm.phase === 'PLAYING'
                  ? 'نوبت شماست — کارت مجاز را لمس کنید'
                  : 'در انتظار حرکت میز...'}
            </span>
          </div>

          <div className="madar-scroll-x py-3 px-1">
            <div className="inline-flex items-end gap-1.5 sm:gap-2 min-w-full justify-start sm:justify-center">
              {myHand.map((card, idx) => {
                const canPlay =
                  hokm.phase === 'PLAYING' &&
                  hokm.turn === 0 &&
                  !busy &&
                  isCardPlayable(hokm, 0, card.id);
                return (
                  <motion.div
                    key={card.id}
                    initial={liteMode ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.025, 0.25) }}
                  >
                    <PlayingCardSVG
                      suit={card.suit}
                      rank={card.rank}
                      size="md"
                      isTrump={card.suit === hokm.hokm}
                      playable={canPlay}
                      disabled={!canPlay}
                      onClick={() => handlePlayCard(card.id)}
                    />
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
