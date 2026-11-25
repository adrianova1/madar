'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Crown, Play, RotateCcw, Sparkles, Timer, Trophy } from 'lucide-react';
import { isCardPlayable, SEAT_LABELS, SUIT_META, type Seat, type Suit } from '@/lib/hokm-engine';
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const hokm = room?.gameType === 'hokm' ? room.hokm : undefined;
  const mySeat = (hokm?.mySeat ?? 0) as Seat;

  // Live polling & server-timer sync when inside an active Hokm room
  useEffect(() => {
    if (!room || room.gameType !== 'hokm' || !token) return;
    const sync = async () => {
      try {
        const res = await fetch(`/api/games/engine?roomCode=${encodeURIComponent(room.roomCode)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.room) onRoomChange(data.room);
        }
      } catch {
        // ignore transient network error
      }
    };
    const id = setInterval(() => void sync(), 4000);
    return () => clearInterval(id);
  }, [room, token, onRoomChange]);

  useEffect(() => {
    if (!hokm?.turnDeadline || hokm.phase !== 'PLAYING') return;
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [hokm?.turnDeadline, hokm?.phase]);

  const secondsLeft =
    hokm?.turnDeadline && hokm.phase === 'PLAYING'
      ? Math.max(0, Math.ceil((hokm.turnDeadline - nowMs) / 1000))
      : null;

  async function callEngine(payload: Record<string, unknown>) {
    if (!token) {
      setErr('ابتدا وارد حساب تلگرام خود شوید.');
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

  // ==================== LOBBY ====================
  if (!hokm || !room) {
    return (
      <div className="madar-glass rounded-3xl p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Crown className="w-5 h-5 text-amber-400" />
              <span>میز حکم چهارنفره</span>
            </h2>
            <p className="text-xs text-slate-400">تعداد دست برای قهرمانی را انتخاب کن</p>
          </div>
          <div className="flex items-center -space-x-5 space-x-reverse shrink-0">
            <div className="-rotate-10">
              <PlayingCardSVG suit="spades" rank={14} size="xs" isTrump />
            </div>
            <div className="rotate-8">
              <PlayingCardSVG suit="hearts" rank={13} size="xs" />
            </div>
          </div>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
            {err}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2.5">
          {[3, 5, 7].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTargetHands(n)}
              className={`rounded-xl border py-3 text-xs font-bold min-h-[46px] transition-colors ${
                targetHands === n
                  ? 'border-[#38bdf8] bg-[#38bdf8]/15 text-[#38bdf8]'
                  : 'border-[#23303e] bg-[#0e1621] text-slate-300'
              }`}
            >
              {n} دست
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={createHokmRoom}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60 min-h-[48px]"
        >
          <Play className="w-4 h-4" />
          <span>{busy ? 'در حال پخش کارت‌ها...' : 'شروع حکم'}</span>
        </button>
      </div>
    );
  }

  // ==================== ACTIVE 4-PLAYER TABLE ====================
  const myHand = hokm.hands[mySeat] || [];
  const trickBySeat = new Map<number, (typeof hokm.currentTrick)[number]>();
  for (const t of hokm.currentTrick) trickBySeat.set(t.seat, t);

  const trumpMeta = hokm.hokm ? SUIT_META[hokm.hokm] : null;
  const myTeam = mySeat % 2;
  const userWonMatch = hokm.matchScore[myTeam] > hokm.matchScore[1 - myTeam];

  const partnerSeat = ((mySeat + 2) % 4) as Seat;
  const rightSeat = ((mySeat + 1) % 4) as Seat;
  const leftSeat = ((mySeat + 3) % 4) as Seat;

  return (
    <div className="space-y-3.5 min-w-0">
      {/* Compact Score & Timer HUD */}
      <div className="madar-glass rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-slate-300">
            ما: <strong className="font-mono tabular-nums text-emerald-300">{hokm.matchScore[myTeam]}</strong>
            <span className="text-slate-600 mx-1">/</span>
            حریف: <strong className="font-mono tabular-nums text-rose-300">{hokm.matchScore[1 - myTeam]}</strong>
          </span>
          <span className="text-slate-400">
            دست: <strong className="font-mono tabular-nums text-white">{hokm.tricksWon[myTeam]}</strong>-
            <strong className="font-mono tabular-nums text-white">{hokm.tricksWon[1 - myTeam]}</strong>
          </span>
          {trumpMeta && (
            <span className="font-bold text-amber-300">
              {trumpMeta.symbol} {trumpMeta.fa}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {secondsLeft !== null && (
            <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[#38bdf8]">
              <Timer className="w-3.5 h-3.5" />
              {secondsLeft}s
            </span>
          )}
          <button
            type="button"
            onClick={() => onRoomChange(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#23303e] px-2.5 py-1.5 text-slate-300 hover:text-white min-h-[34px]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>میز جدید</span>
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-200">
          {err}
        </div>
      )}

      {/* 4-Player Table */}
      <div className="madar-card-table rounded-3xl border border-[#23303e] p-3.5 sm:p-5 space-y-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-[#0e1621]/85 border border-[#23303e] rounded-xl px-3 py-2">
          <span className="text-slate-200 truncate">{hokm.lastEvent}</span>
          <span className="text-amber-300 font-semibold shrink-0">
            نوبت: {room.players[hokm.turn]?.name || SEAT_LABELS[hokm.turn]}
          </span>
        </div>

        {/* Partner Seat */}
        <div className="flex flex-col items-center gap-1">
          <span className={`text-[11px] font-semibold ${hokm.turn === partnerSeat ? 'text-amber-300' : 'text-slate-300'}`}>
            {room.players[partnerSeat]?.name || 'یار'} ({hokm.handCounts[partnerSeat]})
          </span>
          <div className="flex items-center justify-center -space-x-6 space-x-reverse">
            {Array.from({ length: Math.min(4, hokm.handCounts[partnerSeat]) }).map((_, i) => (
              <PlayingCardBackSVG key={i} size="xs" className="opacity-80" />
            ))}
          </div>
        </div>

        {/* Middle Row */}
        <div className="grid grid-cols-12 items-center gap-1.5 sm:gap-3 min-h-[185px] sm:min-h-[220px]">
          <div className="col-span-2 sm:col-span-3 flex flex-col items-center gap-1">
            <span className={`text-[11px] font-semibold text-center truncate max-w-full ${hokm.turn === rightSeat ? 'text-amber-300' : 'text-slate-400'}`}>
              {room.players[rightSeat]?.name || 'حریف ۱'}
            </span>
            <span className="text-[10px] font-mono text-slate-500">{hokm.handCounts[rightSeat]} کارت</span>
          </div>

          <div className="col-span-8 sm:col-span-6 relative flex flex-col items-center justify-center min-h-[175px] sm:min-h-[210px] rounded-2xl border border-[#23303e] bg-[#0e1621]/80 p-2.5">
            {hokm.phase === 'CHOOSE_HOKM' ? (
              <div className="text-center space-y-2.5 w-full">
                <p className="text-xs font-bold text-amber-300">خال حکم را انتخاب کن:</p>
                <div className="grid grid-cols-2 gap-2">
                  {SUIT_LIST.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => handleChooseSuit(s)}
                      className="rounded-xl border border-amber-400/40 bg-[#17212b] hover:bg-amber-400 hover:text-slate-950 py-2.5 px-2 text-xs sm:text-sm font-bold transition-colors min-h-[44px] flex items-center justify-center gap-1.5"
                    >
                      <span className={s === 'hearts' || s === 'diamonds' ? 'text-rose-400' : 'text-[#38bdf8]'}>
                        {SUIT_META[s].symbol}
                      </span>
                      <span>{SUIT_META[s].fa}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : hokm.phase === 'HAND_OVER' ? (
              <div className="text-center space-y-2.5">
                <Sparkles className="w-6 h-6 text-amber-400 mx-auto" />
                <p className="text-sm font-bold text-white">پایان دست {hokm.roundNumber}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleNextHand}
                  className="rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-300 min-h-[42px]"
                >
                  پخش دست بعدی
                </button>
              </div>
            ) : hokm.phase === 'MATCH_OVER' ? (
              <div className="text-center space-y-2.5">
                <Trophy className={`w-8 h-8 mx-auto ${userWonMatch ? 'text-amber-400' : 'text-slate-400'}`} />
                <p className="text-sm font-bold text-white">
                  {userWonMatch ? 'پیروزی تیم شما!' : 'پایان مسابقه حکم'}
                </p>
                <button
                  type="button"
                  onClick={createHokmRoom}
                  className="rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-300 min-h-[42px]"
                >
                  مسابقه جدید
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 grid-rows-3 items-center justify-items-center w-full h-full gap-1">
                <div className="col-start-2 row-start-1">
                  <AnimatePresence>
                    {trickBySeat.has(partnerSeat) && (
                      <motion.div
                        key={trickBySeat.get(partnerSeat)!.card.id}
                        initial={liteMode ? false : { opacity: 0, y: -16 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <PlayingCardSVG
                          suit={trickBySeat.get(partnerSeat)!.card.suit}
                          rank={trickBySeat.get(partnerSeat)!.card.rank}
                          size="xs"
                          isTrump={trickBySeat.get(partnerSeat)!.card.suit === hokm.hokm}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="col-start-1 row-start-2">
                  <AnimatePresence>
                    {trickBySeat.has(rightSeat) && (
                      <motion.div
                        key={trickBySeat.get(rightSeat)!.card.id}
                        initial={liteMode ? false : { opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                      >
                        <PlayingCardSVG
                          suit={trickBySeat.get(rightSeat)!.card.suit}
                          rank={trickBySeat.get(rightSeat)!.card.rank}
                          size="xs"
                          isTrump={trickBySeat.get(rightSeat)!.card.suit === hokm.hokm}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="col-start-2 row-start-2 text-center">
                  {hokm.currentTrick.length === 0 && (
                    <span className="text-[11px] text-slate-500">وسط میز</span>
                  )}
                </div>

                <div className="col-start-3 row-start-2">
                  <AnimatePresence>
                    {trickBySeat.has(leftSeat) && (
                      <motion.div
                        key={trickBySeat.get(leftSeat)!.card.id}
                        initial={liteMode ? false : { opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                      >
                        <PlayingCardSVG
                          suit={trickBySeat.get(leftSeat)!.card.suit}
                          rank={trickBySeat.get(leftSeat)!.card.rank}
                          size="xs"
                          isTrump={trickBySeat.get(leftSeat)!.card.suit === hokm.hokm}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="col-start-2 row-start-3">
                  <AnimatePresence>
                    {trickBySeat.has(mySeat) && (
                      <motion.div
                        key={trickBySeat.get(mySeat)!.card.id}
                        initial={liteMode ? false : { opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <PlayingCardSVG
                          suit={trickBySeat.get(mySeat)!.card.suit}
                          rank={trickBySeat.get(mySeat)!.card.rank}
                          size="xs"
                          isTrump={trickBySeat.get(mySeat)!.card.suit === hokm.hokm}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>

          <div className="col-span-2 sm:col-span-3 flex flex-col items-center gap-1">
            <span className={`text-[11px] font-semibold text-center truncate max-w-full ${hokm.turn === leftSeat ? 'text-amber-300' : 'text-slate-400'}`}>
              {room.players[leftSeat]?.name || 'حریف ۲'}
            </span>
            <span className="text-[10px] font-mono text-slate-500">{hokm.handCounts[leftSeat]} کارت</span>
          </div>
        </div>

        {/* Mobile-Safe Playable Card Hand (Zero Clipping on 320px-430px) */}
        <div className="space-y-2 pt-2 border-t border-[#23303e]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">دست شما ({myHand.length})</span>
            <span className={hokm.turn === mySeat && hokm.phase === 'PLAYING' ? 'text-emerald-300 font-semibold' : 'text-slate-400'}>
              {hokm.phase === 'CHOOSE_HOKM'
                ? '۵ کارت اولیه'
                : hokm.turn === mySeat && hokm.phase === 'PLAYING'
                  ? 'نوبت شماست'
                  : 'در انتظار میز...'}
            </span>
          </div>

          <div className="w-full max-w-full madar-scroll-x py-2 px-1">
            <div className="inline-flex items-end gap-1.5 sm:gap-2 px-1">
              {myHand.map((card) => {
                const canPlay =
                  hokm.phase === 'PLAYING' &&
                  hokm.turn === mySeat &&
                  !busy &&
                  isCardPlayable(hokm, mySeat, card.id);
                return (
                  <div key={card.id} className="shrink-0">
                    <PlayingCardSVG
                      suit={card.suit}
                      rank={card.rank}
                      size="sm"
                      isTrump={card.suit === hokm.hokm}
                      playable={canPlay}
                      disabled={!canPlay}
                      onClick={() => handlePlayCard(card.id)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
