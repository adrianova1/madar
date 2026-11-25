'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Eye,
  EyeOff,
  Lock,
  MessageSquare,
  Monitor,
  Moon,
  Play,
  RotateCcw,
  Shield,
  Smartphone,
  Sun,
  Timer,
  Trophy,
  Vote,
} from 'lucide-react';
import { triggerHaptic, triggerHapticNotice } from '@/lib/telegram-webapp';
import { madarSound } from './SoundFX';
import type { SanitizedEngineRoom } from './types';

interface SyncedGameRoom {
  roomCode: string;
  gameType: string;
  phase: string;
  dayNumber: number;
  status: string;
  groupChatId: string;
  players: { id: string; name: string; alive: boolean; isCurrentUser: boolean }[];
  votes: Record<string, string>;
  channelLog: { channel: 'telegram_group' | 'bot_dm' | 'mini_app'; text: string; at: string }[];
  updatedAt: string;
}

interface PrivateDmRole {
  playerName: string;
  roleKey: string;
  roleTitle: string;
  team: string;
  description: string;
}

interface MafiaArenaProps {
  token: string | null;
  room: SanitizedEngineRoom | null;
  liteMode: boolean;
  onRoomChange: (room: SanitizedEngineRoom | null) => void;
  onRewardNotice: (msg: string) => void;
  onRefreshUser: () => Promise<void>;
}

export default function MafiaArena({
  token,
  room,
  liteMode,
  onRoomChange,
  onRewardNotice,
  onRefreshUser,
}: MafiaArenaProps) {
  const [execMode, setExecMode] = useState<'auto' | 'trimode'>('auto');
  const [scenario, setScenario] = useState<'classic' | 'tactical'>('classic');
  const [namesInput, setNamesInput] = useState('نیلوفر، سارا، کیان، تارا، آرمان، سپهر');
  const [roleRevealed, setRoleRevealed] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(45);

  const [syncRoom, setSyncRoom] = useState<SyncedGameRoom | null>(null);
  const [dmRole, setDmRole] = useState<PrivateDmRole | null>(null);
  const [activeVoterId, setActiveVoterId] = useState<string>('p_1');

  const mafia = room?.gameType === 'mafia' ? room.mafia : undefined;

  const syncFromServer = useCallback(async () => {
    if (!room || room.gameType !== 'mafia' || !token) return;
    try {
      const res = await fetch(`/api/games/engine?roomCode=${encodeURIComponent(room.roomCode)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.room) onRoomChange(data.room);
      }
    } catch {
      // ignore transient poll error
    }
  }, [room, token, onRoomChange]);

  // Live 3s polling sync so server-authoritative phase transitions reach all players
  useEffect(() => {
    if (!room || room.gameType !== 'mafia' || !token || mafia?.phase === 'GAME_OVER') return;
    const id = setInterval(() => void syncFromServer(), 3000);
    return () => clearInterval(id);
  }, [room, token, mafia?.phase, syncFromServer]);

  useEffect(() => {
    if (!mafia?.phaseEndsAt || mafia.phase === 'GAME_OVER') return;
    let syncedZero = false;
    const tick = () => {
      const rem = Math.max(0, Math.ceil((mafia.phaseEndsAt - Date.now()) / 1000));
      setSecondsLeft(rem);
      if (rem === 0 && !syncedZero) {
        syncedZero = true;
        void syncFromServer();
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [mafia?.phaseEndsAt, mafia?.phase, syncFromServer]);

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
        setErr(data.error || 'خطا در اجرای موتور مافیا');
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

  async function startAutoMafia() {
    const list = namesInput
      .split(/[،,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    madarSound.playNightTransition();
    triggerHaptic('medium');
    setRoleRevealed(false);
    setSelectedTarget(null);
    await callEngine({
      action: 'create_room',
      gameType: 'mafia',
      mafiaScenario: scenario,
      playerNames: list,
    });
  }

  async function submitNightAction() {
    if (!room) return;
    madarSound.playNightTransition();
    await callEngine({
      action: 'mafia_night_action',
      roomCode: room.roomCode,
      targetId: selectedTarget || undefined,
    });
    setSelectedTarget(null);
  }

  async function startVoting() {
    if (!room) return;
    madarSound.playClick();
    await callEngine({ action: 'mafia_start_vote', roomCode: room.roomCode });
    setSelectedTarget(null);
  }

  async function castVote(targetId: string) {
    if (!room) return;
    madarSound.playClick();
    triggerHaptic('medium');
    await callEngine({ action: 'mafia_vote', roomCode: room.roomCode, targetId });
    setSelectedTarget(null);
  }

  // ==================== FIXED TRI-MODE TELEGRAM SYNC HANDLERS ====================
  async function createTriModeRoom() {
    if (!token) {
      setErr('ابتدا وارد حساب تلگرام شوید.');
      return;
    }
    const list = namesInput
      .split(/[،,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length < 6) {
      setErr('حداقل ۶ نام بازیکن وارد کنید.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/games/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'create', gameType: 'mafia', playerNames: list, groupTitle: 'گروه تلگرام مدار' }),
      });
      const data = await res.json();
      if (res.ok && data.room) {
        setSyncRoom(data.room);
        setDmRole(null);
        setActiveVoterId(data.room.players[0]?.id || 'p_1');
      } else {
        setErr(data.error || 'خطا در ایجاد اتاق همگام');
      }
    } finally {
      setBusy(false);
    }
  }

  async function castSyncedVote(targetId: string) {
    if (!token || !syncRoom) return;
    const res = await fetch('/api/games/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'cast_vote',
        roomCode: syncRoom.roomCode,
        voterId: activeVoterId,
        targetId,
        channel: 'telegram_group',
      }),
    });
    const data = await res.json();
    if (res.ok && data.room) setSyncRoom(data.room);
    else if (data.error) setErr(data.error);
  }

  async function fetchDmRole() {
    if (!token || !syncRoom) return;
    const res = await fetch('/api/games/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'request_dm_role', roomCode: syncRoom.roomCode, playerId: activeVoterId }),
    });
    const data = await res.json();
    if (res.ok && data.privateDmPayload) {
      setDmRole(data.privateDmPayload);
    } else if (data.error) {
      setErr(data.error);
    }
  }

  async function resolveSyncedVotes() {
    if (!token || !syncRoom) return;
    const res = await fetch('/api/games/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'resolve_votes', roomCode: syncRoom.roomCode }),
    });
    const data = await res.json();
    if (res.ok && data.room) setSyncRoom(data.room);
    else if (data.error) setErr(data.error);
  }

  const isNight = mafia?.phase === 'NIGHT_ACTION';
  const myRole = mafia?.myRole;
  const needsNightTarget =
    isNight &&
    myRole &&
    ['mafia', 'doctor', 'detective', 'sniper'].includes(myRole.key) &&
    mafia.aliveIds.includes(mafia.myPlayerId || '');

  return (
    <div className="space-y-4 min-w-0">
      {/* Compact Mode Switcher */}
      <div className="madar-glass rounded-2xl p-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setExecMode('auto')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl min-h-[40px] transition-colors ${
            execMode === 'auto' ? 'bg-[#38bdf8] text-slate-950' : 'text-slate-300 hover:text-white'
          }`}
        >
          گرداننده خودکار
        </button>
        <button
          type="button"
          onClick={() => setExecMode('trimode')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl min-h-[40px] transition-colors ${
            execMode === 'trimode' ? 'bg-[#38bdf8] text-slate-950' : 'text-slate-300 hover:text-white'
          }`}
        >
          همگام گروه تلگرام
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
          {err}
        </div>
      )}

      {execMode === 'trimode' ? (
        <div className="madar-glass rounded-3xl p-4 sm:p-6 space-y-4">
          {!syncRoom ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-300">نام حداقل ۶ بازیکن را با کاما وارد کن:</p>
              <textarea
                rows={2}
                value={namesInput}
                onChange={(e) => setNamesInput(e.target.value)}
                className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] p-3 text-base sm:text-sm text-white"
              />
              <button
                type="button"
                disabled={busy}
                onClick={createTriModeRoom}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8] px-5 py-3 text-sm font-bold text-slate-950 min-h-[46px]"
              >
                <Play className="w-4 h-4" />
                <span>{busy ? 'در حال ایجاد...' : 'ساخت اتاق همگام'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>
                  اتاق <strong className="font-mono text-[#38bdf8]">{syncRoom.roomCode}</strong> · روز{' '}
                  <strong className="font-mono text-white">{syncRoom.dayNumber}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSyncRoom(null);
                    setDmRole(null);
                  }}
                  className="rounded-lg border border-[#23303e] px-3 py-1.5 text-xs text-slate-300"
                >
                  بستن
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
                <div className="rounded-2xl border border-[#23303e] bg-[#0e1621] p-3.5 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#38bdf8]">
                    <MessageSquare className="w-4 h-4" />
                    <span>رأی گروه</span>
                  </div>
                  <select
                    value={activeVoterId}
                    onChange={(e) => setActiveVoterId(e.target.value)}
                    className="w-full rounded-lg border border-[#23303e] bg-[#17212b] px-2.5 py-2 text-xs text-white"
                  >
                    {syncRoom.players.filter((p) => p.alive).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-1.5">
                    {syncRoom.players.filter((p) => p.alive).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => castSyncedVote(p.id)}
                        className="rounded-lg border border-[#23303e] bg-[#17212b] py-2 text-xs text-slate-100 hover:border-[#38bdf8] min-h-[38px]"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[#23303e] bg-[#0e1621] p-3.5 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                      <Lock className="w-4 h-4" />
                      <span>نقش محرمانه پی‌وی</span>
                    </div>
                    {dmRole ? (
                      <div className="rounded-xl border border-amber-400/35 bg-amber-400/10 p-3 space-y-1">
                        <p className="text-[11px] text-amber-200">{dmRole.playerName} · {dmRole.team}</p>
                        <p className="text-base font-bold text-white">{dmRole.roleTitle}</p>
                        <p className="text-xs text-slate-300">{dmRole.description}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">نقش مخفی است.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={fetchDmRole}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 py-2.5 text-xs font-bold text-slate-950 min-h-[42px]"
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>نمایش نقش این بازیکن</span>
                  </button>
                </div>

                <div className="rounded-2xl border border-[#23303e] bg-[#0e1621] p-3.5 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                      <Monitor className="w-4 h-4" />
                      <span>تابلوی آرا</span>
                    </div>
                    {syncRoom.players.map((p) => {
                      const votesCount = Object.values(syncRoom.votes).filter((v) => v === p.id).length;
                      return (
                        <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-[#23303e]">
                          <span className={p.alive ? 'text-slate-100' : 'text-slate-500 line-through'}>{p.name}</span>
                          <span className="font-mono text-amber-300">{p.alive ? `${votesCount} رأی` : 'حذف'}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={resolveSyncedVotes}
                    className="w-full rounded-xl border border-emerald-400/50 bg-emerald-400/15 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-400 hover:text-slate-950 min-h-[42px]"
                  >
                    شمارش آرا
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : !mafia || !room ? (
        <div className="madar-glass rounded-3xl p-5 sm:p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { id: 'classic', title: 'سناریوی کلاسیک', desc: 'شهروند، مافیا، دکتر، کارآگاه' },
              { id: 'tactical', title: 'سناریوی تاکتیکی', desc: 'کلاسیک + تک‌تیرانداز' },
            ].map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setScenario(sc.id as 'classic' | 'tactical')}
                className={`rounded-2xl border p-4 text-right transition-colors min-h-[68px] ${
                  scenario === sc.id
                    ? 'border-[#38bdf8] bg-[#38bdf8]/12 text-white'
                    : 'border-[#23303e] bg-[#0e1621] text-slate-300'
                }`}
              >
                <p className="text-sm font-bold">{sc.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">{sc.desc}</p>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-300 block">نام بازیکنان میز (با کاما)</label>
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
            onClick={startAutoMafia}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#8b5cf6] px-6 py-3.5 text-sm font-bold text-white hover:brightness-110 min-h-[48px]"
          >
            <Play className="w-4 h-4" />
            <span>{busy ? 'در حال توزیع نقش‌ها...' : 'شروع مافیا'}</span>
          </button>
        </div>
      ) : (
        <div
          className={`rounded-3xl border p-4 sm:p-5 space-y-4 ${
            isNight ? 'border-purple-500/35 bg-[#121629]' : 'border-[#23303e] bg-[#17212b]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#23303e]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  isNight ? 'bg-purple-500/20 text-purple-300' : 'bg-amber-400/15 text-amber-300'
                }`}
              >
                {isNight ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-400 font-mono">روز {mafia.dayNumber}</p>
                <h3 className="text-sm sm:text-base font-bold text-white truncate">
                  {mafia.phase === 'NIGHT_ACTION'
                    ? 'فاز شب'
                    : mafia.phase === 'DAY_DISCUSSION'
                      ? 'فاز روز و بحث'
                      : mafia.phase === 'VOTING'
                        ? 'فاز رأی‌گیری'
                        : 'پایان بازی'}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {mafia.phase !== 'GAME_OVER' && (
                <span className="inline-flex items-center gap-1 font-mono tabular-nums text-xs text-[#38bdf8] bg-[#0e1621] border border-[#23303e] rounded-lg px-2.5 py-1.5">
                  <Timer className="w-3.5 h-3.5" />
                  {secondsLeft}s
                </span>
              )}
              <button
                type="button"
                onClick={() => onRoomChange(null)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#23303e] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white min-h-[34px]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>جدید</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7">
              <div className="relative w-full max-w-[340px] aspect-square mx-auto flex items-center justify-center">
                <div className="pointer-events-none absolute inset-[10%] rounded-full border border-[#23303e] bg-[#0e1621]/90" />
                <div className="relative z-10 text-center space-y-1">
                  <Shield className={`w-6 h-6 mx-auto ${isNight ? 'text-purple-300' : 'text-amber-300'}`} />
                  <p className="text-xs font-mono text-[#38bdf8]">{mafia.aliveIds.length} زنده</p>
                </div>

                {room.players.map((p, idx) => {
                  const deg = (360 / room.players.length) * idx;
                  const rad = ((deg - 90) * Math.PI) / 180;
                  const x = 50 + Math.cos(rad) * 42;
                  const y = 50 + Math.sin(rad) * 42;
                  const alive = mafia.aliveIds.includes(p.id);
                  const isPicked = selectedTarget === p.id;
                  const revealed = mafia.revealedRoles?.[p.id];
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!alive || (mafia.phase !== 'NIGHT_ACTION' && mafia.phase !== 'VOTING')}
                      onClick={() => setSelectedTarget(p.id)}
                      style={{ left: `${x}%`, top: `${y}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center cursor-pointer disabled:cursor-default"
                    >
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 transition-all ${
                          !alive
                            ? 'opacity-30 grayscale border-slate-700'
                            : isPicked
                              ? 'border-amber-400 scale-110'
                              : 'border-[#23303e] hover:border-[#38bdf8]'
                        }`}
                        style={{ backgroundColor: p.avatarColor }}
                      >
                        {p.avatarInitials}
                      </div>
                      <span
                        className={`mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                          !alive
                            ? 'bg-slate-900/80 text-slate-500 line-through'
                            : isPicked
                              ? 'bg-amber-400 text-slate-950'
                              : 'bg-[#0e1621]/95 text-slate-100'
                        }`}
                      >
                        {p.name}
                      </span>
                      {revealed && (
                        <span className="text-[9px] text-amber-300 bg-[#0e1621] px-1 rounded mt-0.5">
                          {revealed.title}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-5 space-y-3.5">
              {myRole && (
                <motion.div
                  layout={!liteMode}
                  className="rounded-2xl border border-amber-400/35 bg-[#0e1621] p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300">نقش مخفی شما</span>
                    <button
                      type="button"
                      onClick={() => setRoleRevealed((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs text-[#38bdf8] min-h-[32px]"
                    >
                      {roleRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{roleRevealed ? 'مخفی' : 'نمایش'}</span>
                    </button>
                  </div>
                  {roleRevealed ? (
                    <div>
                      <p className="text-base font-bold text-white">{myRole.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{myRole.description}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">برای مشاهده لمس کن</p>
                  )}
                  {mafia.detectiveIntel && (
                    <div className="rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/10 p-2.5 text-xs text-sky-100">
                      {mafia.detectiveIntel}
                    </div>
                  )}
                </motion.div>
              )}

              <div className="rounded-2xl border border-[#23303e] bg-[#0e1621] p-4 space-y-3">
                <p className="text-xs text-slate-200 leading-relaxed">{mafia.nightSummary}</p>

                {mafia.phase === 'NIGHT_ACTION' && (
                  <button
                    type="button"
                    disabled={busy || (Boolean(needsNightTarget) && !selectedTarget)}
                    onClick={submitNightAction}
                    className="w-full rounded-xl bg-[#8b5cf6] py-3 text-xs sm:text-sm font-bold text-white hover:brightness-110 disabled:opacity-50 min-h-[44px]"
                  >
                    {busy ? 'در حال ثبت...' : needsNightTarget ? 'تأیید هدف شب' : 'پایان شب'}
                  </button>
                )}

                {mafia.phase === 'DAY_DISCUSSION' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={startVoting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 py-3 text-xs sm:text-sm font-bold text-slate-950 min-h-[44px]"
                  >
                    <Vote className="w-4 h-4" />
                    <span>شروع رأی‌گیری</span>
                  </button>
                )}

                {mafia.phase === 'VOTING' && (
                  <div className="grid grid-cols-2 gap-2">
                    {room.players
                      .filter((p) => mafia.aliveIds.includes(p.id))
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          disabled={busy}
                          onClick={() => castVote(p.id)}
                          className="rounded-xl border border-[#23303e] bg-[#17212b] hover:border-amber-400 py-2.5 px-2 text-xs font-semibold text-white min-h-[40px]"
                        >
                          رأی به {p.name}
                        </button>
                      ))}
                  </div>
                )}

                {mafia.phase === 'GAME_OVER' && (
                  <div className="text-center space-y-2.5">
                    <Trophy className="w-8 h-8 text-amber-400 mx-auto" />
                    <p className="text-sm font-bold text-white">
                      {mafia.winner === 'citizens' ? 'پیروزی شهروندان!' : 'پیروزی مافیا!'}
                    </p>
                    <button
                      type="button"
                      onClick={startAutoMafia}
                      className="w-full rounded-xl bg-amber-400 py-3 text-xs font-bold text-slate-950 min-h-[44px]"
                    >
                      دور جدید
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-[#23303e] bg-[#0e1621] p-3 space-y-1.5 max-h-32 overflow-y-auto madar-scroll-y">
                {mafia.log.slice(0, 6).map((ev, idx) => (
                  <div key={idx} className="text-[11px] text-slate-300 flex justify-between gap-2">
                    <span>{ev.text}</span>
                    <span className="font-mono text-[10px] text-slate-500 shrink-0">{ev.at}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
