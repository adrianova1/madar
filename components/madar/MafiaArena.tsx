'use client';

import React, { useEffect, useState } from 'react';
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
  // Primary mode: Auto-Moderated (confirmed), Secondary: Telegram Tri-Mode Sync (preserved)
  const [execMode, setExecMode] = useState<'auto' | 'trimode'>('auto');
  const [scenario, setScenario] = useState<'classic' | 'tactical'>('classic');
  const [namesInput, setNamesInput] = useState('نیلوفر، سارا، کیان، تارا، آرمان، سپهر');
  const [roleRevealed, setRoleRevealed] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(45);

  // Preserved Tri-Mode Telegram Sync state
  const [syncRoom, setSyncRoom] = useState<SyncedGameRoom | null>(null);
  const [dmRole, setDmRole] = useState<PrivateDmRole | null>(null);
  const [activeVoterId, setActiveVoterId] = useState<string>('p_1');

  const mafia = room?.gameType === 'mafia' ? room.mafia : undefined;

  useEffect(() => {
    if (!mafia?.phaseEndsAt) return;
    const tick = () => {
      setSecondsLeft(Math.max(0, Math.ceil((mafia.phaseEndsAt - Date.now()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [mafia?.phaseEndsAt]);

  async function callEngine(payload: Record<string, unknown>) {
    if (!token) {
      setErr('برای شروع مافیای خودکار ابتدا وارد حساب مدار شوید.');
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

  // ==================== PRESERVED TRI-MODE TELEGRAM SYNC HANDLERS ====================
  async function createTriModeRoom() {
    if (!token) {
      setErr('برای ساخت اتاق سه‌حالته تلگرام ابتدا وارد حساب مدار شوید.');
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
        body: JSON.stringify({ action: 'create', gameType: 'mafia', playerNames: list, groupTitle: 'کهکشان دوستان مدار' }),
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
        action: 'vote',
        roomCode: syncRoom.roomCode,
        voterId: activeVoterId,
        targetId,
        channel: 'telegram_group',
      }),
    });
    const data = await res.json();
    if (res.ok && data.room) setSyncRoom(data.room);
  }

  async function fetchDmRole() {
    if (!token || !syncRoom) return;
    const res = await fetch('/api/games/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'request_dm_role', roomCode: syncRoom.roomCode }),
    });
    const data = await res.json();
    if (res.ok && data.privateRole) {
      setDmRole(data.privateRole);
      if (data.room) setSyncRoom(data.room);
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
  }

  const isNight = mafia?.phase === 'NIGHT_ACTION';
  const myRole = mafia?.myRole;
  const needsNightTarget =
    isNight &&
    myRole &&
    ['mafia', 'doctor', 'detective', 'sniper'].includes(myRole.key) &&
    mafia.aliveIds.includes(mafia.myPlayerId || '');

  return (
    <div className="space-y-5 min-w-0">
      {/* Mode Switcher: Auto-Moderated (Default) vs Telegram Tri-Mode Sync */}
      <div className="madar-glass rounded-2xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-xs font-bold text-white">حالت اجرای مافیای مدار</p>
          <p className="text-[11px] text-slate-400">
            گرداننده خودکار بدون نیاز به راوی انسانی + همگام‌سازی کامل با گروه تلگرام
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-[#050816] border border-indigo-500/25 rounded-xl">
          <button
            type="button"
            onClick={() => setExecMode('auto')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg min-h-[38px] transition-colors ${
              execMode === 'auto' ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            گرداننده خودکار
          </button>
          <button
            type="button"
            onClick={() => setExecMode('trimode')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg min-h-[38px] transition-colors ${
              execMode === 'trimode' ? 'bg-cyan-400 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            همگام تلگرام (سه‌حالته)
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          {err}
        </div>
      )}

      {execMode === 'trimode' ? (
        <div className="madar-glass rounded-3xl p-5 sm:p-6 space-y-5">
          {!syncRoom ? (
            <div className="max-w-2xl mx-auto space-y-4">
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                در معماری سه‌حالته تلگرام، بازیکنان با دکمه‌های شیشه‌ای در گروه رأی می‌دهند، نقش محرمانه فقط در پی‌وی ربات تحویل می‌شود و تابلوی شهر در Mini App زنده می‌ماند.
              </p>
              <textarea
                rows={2}
                value={namesInput}
                onChange={(e) => setNamesInput(e.target.value)}
                className="w-full rounded-xl border border-indigo-500/30 bg-[#050816] p-3 text-base sm:text-sm text-white"
              />
              <button
                type="button"
                disabled={busy}
                onClick={createTriModeRoom}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300 min-h-[46px]"
              >
                <Play className="w-4 h-4" />
                <span>{busy ? 'در حال ایجاد...' : 'ساخت اتاق همگام تلگرام'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>
                  کد اتاق: <strong className="font-mono text-amber-300">{syncRoom.roomCode}</strong> · روز{' '}
                  <strong className="font-mono text-white">{syncRoom.dayNumber}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSyncRoom(null);
                    setDmRole(null);
                  }}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
                >
                  بستن اتاق
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-sky-500/30 bg-[#050816] p-4 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-sky-300">
                    <MessageSquare className="w-4 h-4" />
                    <span>۱. گروه تلگرام</span>
                  </div>
                  <select
                    value={activeVoterId}
                    onChange={(e) => setActiveVoterId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#0a1026] px-2.5 py-2 text-xs text-white"
                  >
                    {syncRoom.players.filter((p) => p.alive).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    {syncRoom.players.filter((p) => p.alive).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => castSyncedVote(p.id)}
                        className="rounded-lg border border-sky-400/40 bg-sky-400/10 py-2 text-xs text-sky-100 hover:bg-sky-400 hover:text-slate-950 min-h-[38px]"
                      >
                        رأی به {p.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-400/35 bg-[#050816] p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                      <Lock className="w-4 h-4" />
                      <span>۲. پی‌وی ربات (نقش محرمانه)</span>
                    </div>
                    {dmRole ? (
                      <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 space-y-1">
                        <p className="text-[11px] text-amber-200">{dmRole.playerName} · {dmRole.team}</p>
                        <p className="text-base font-bold text-white">{dmRole.roleTitle}</p>
                        <p className="text-xs text-slate-300">{dmRole.description}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">نقش محرمانه مهروموم شده است.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={fetchDmRole}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 py-2.5 text-xs font-bold text-slate-950 min-h-[42px]"
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>مشاهده نقش در پی‌وی</span>
                  </button>
                </div>

                <div className="rounded-2xl border border-emerald-500/30 bg-[#050816] p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                      <Monitor className="w-4 h-4" />
                      <span>۳. تابلوی زنده Mini App</span>
                    </div>
                    {syncRoom.players.map((p) => {
                      const votesCount = Object.values(syncRoom.votes).filter((v) => v === p.id).length;
                      return (
                        <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/70">
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
                    شمارش آرا و پایان روز
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : !mafia || !room ? (
        /* ==================== AUTO-MODERATED MAFIA LOBBY ==================== */
        <div className="madar-glass rounded-3xl p-5 sm:p-8 space-y-6">
          <div className="space-y-1.5 pb-4 border-b border-indigo-500/20">
            <p className="text-xs text-purple-300">گرداننده خودکار سمت سرور · بدون نیاز به راوی</p>
            <h2 className="text-xl sm:text-2xl font-bold text-white">لابی مافیای خودکار مدار</h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              توزیع امن نقش‌ها، مدیریت چرخه شب و روز، اکشن نقش‌های ویژه، رأی‌گیری هوشمند ربات‌ها و تشخیص برنده کاملاً به‌صورت خودکار انجام می‌شود.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { id: 'classic', title: 'سناریوی کلاسیک مدار', desc: 'شهروند، مافیا، دکتر، کارآگاه (۶+ نفر)' },
              { id: 'tactical', title: 'سناریوی تاکتیکی', desc: 'کلاسیک + تک‌تیرانداز (۷+ نفر)' },
            ].map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setScenario(sc.id as 'classic' | 'tactical')}
                className={`rounded-2xl border p-4 text-right transition-colors min-h-[72px] ${
                  scenario === sc.id
                    ? 'border-amber-400 bg-amber-400/15 text-white'
                    : 'border-indigo-500/25 bg-[#050816] text-slate-300 hover:border-purple-400/50'
                }`}
              >
                <p className="text-sm font-bold">{sc.title}</p>
                <p className="text-xs text-slate-400 mt-1">{sc.desc}</p>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-xs text-slate-300 block">نام هم‌تیمی‌ها / ربات‌های میز (با کاما):</label>
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
            onClick={startAutoMafia}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-purple-500 to-indigo-500 px-7 py-3 text-sm font-bold text-white hover:brightness-110 min-h-[48px]"
          >
            <Play className="w-4 h-4" />
            <span>{busy ? 'در حال توزیع نقش‌ها...' : 'شروع مافیا با گرداننده خودکار'}</span>
          </button>
        </div>
      ) : (
        /* ==================== ACTIVE AUTO-MODERATED MAFIA TABLE ==================== */
        <div
          className={`rounded-3xl border p-4 sm:p-6 space-y-5 transition-colors duration-500 ${
            isNight
              ? 'border-purple-500/40 bg-gradient-to-b from-[#0b0724] via-[#070a1e] to-[#050816]'
              : 'border-amber-400/35 bg-gradient-to-b from-[#17122c] via-[#0c1430] to-[#060b1d]'
          }`}
        >
          {/* Phase Atmospheric Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                  isNight ? 'bg-purple-500/20 text-purple-300' : 'bg-amber-400/20 text-amber-300'
                }`}
              >
                {isNight ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </div>
              <div>
                <p className="text-xs text-slate-300 font-mono">
                  {room.roomCode} · روز {mafia.dayNumber}
                </p>
                <h3 className="text-base sm:text-lg font-bold text-white">
                  {mafia.phase === 'NIGHT_ACTION'
                    ? 'فاز شب — زمان حرکت نقش‌های مخفی'
                    : mafia.phase === 'DAY_DISCUSSION'
                      ? 'فاز روز — گزارش صبح و بررسی سرنخ‌ها'
                      : mafia.phase === 'VOTING'
                        ? 'فاز رأی‌گیری — انتخاب فرد مشکوک'
                        : 'پایان بازی مافیا'}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {mafia.phase !== 'GAME_OVER' && (
                <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-xs text-cyan-300 bg-[#050816] border border-cyan-500/30 rounded-lg px-3 py-1.5">
                  <Timer className="w-3.5 h-3.5" />
                  {secondsLeft}s
                </span>
              )}
              <button
                type="button"
                onClick={() => onRoomChange(null)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white min-h-[36px]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>خروج</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Circular Town Table */}
            <div className="lg:col-span-7 space-y-4">
              <div className="relative w-full max-w-[380px] aspect-square mx-auto flex items-center justify-center">
                <div
                  className={`pointer-events-none absolute inset-[10%] rounded-full border-2 ${
                    isNight
                      ? 'border-purple-400/30 bg-[#090620]/85 shadow-[0_0_50px_rgba(124,58,237,0.2)]'
                      : 'border-amber-400/30 bg-[#0d1430]/85 shadow-[0_0_50px_rgba(245,158,11,0.12)]'
                  }`}
                />

                {/* Center Moderator Emblem */}
                <div className="relative z-10 text-center max-w-[165px] space-y-1 px-2">
                  <Shield className={`w-6 h-6 mx-auto ${isNight ? 'text-purple-300' : 'text-amber-300'}`} />
                  <p className="text-[11px] font-semibold text-white">گرداننده خودکار</p>
                  <p className="text-[10px] text-slate-300 leading-relaxed">
                    بازیکنان زنده: <strong className="font-mono text-cyan-300">{mafia.aliveIds.length}</strong> نفر
                  </p>
                </div>

                {/* Players Arranged Around Circle */}
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
                        className={`w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 transition-all ${
                          !alive
                            ? 'opacity-35 grayscale border-slate-700'
                            : isPicked
                              ? 'border-amber-400 scale-110 shadow-[0_0_20px_rgba(245,158,11,0.65)]'
                              : 'border-cyan-400/40 hover:border-white'
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
                              : 'bg-[#050816]/90 text-slate-100'
                        }`}
                      >
                        {p.name}
                      </span>
                      {revealed && (
                        <span className="text-[9px] text-amber-300 bg-[#050816]/90 px-1 rounded mt-0.5">
                          {revealed.title}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Control Column: Secret Role Card + Action Console + Log */}
            <div className="lg:col-span-5 space-y-4">
              {/* Secret Role Card (Flip / Tap to Peek) */}
              {myRole && (
                <motion.div
                  layout={!liteMode}
                  className="rounded-2xl border border-amber-400/35 bg-[#050816]/90 p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-amber-300">کارت نقش محرمانه شما</span>
                    <button
                      type="button"
                      onClick={() => setRoleRevealed((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-white min-h-[34px]"
                    >
                      {roleRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{roleRevealed ? 'مخفی کردن' : 'مشاهده نقش'}</span>
                    </button>
                  </div>
                  {roleRevealed ? (
                    <div className="space-y-1">
                      <p className="text-lg font-bold text-white">
                        {myRole.title}{' '}
                        <span className="text-xs font-normal text-purple-300">({myRole.team})</span>
                      </p>
                      <p className="text-xs text-slate-300 leading-relaxed">{myRole.description}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">
                      برای جلوگیری از دیده‌شدن روی صفحه، کارت نقش مخفی است. برای دیدن لمس کن.
                    </p>
                  )}
                  {mafia.detectiveIntel && (
                    <div className="rounded-xl border border-cyan-400/40 bg-cyan-400/10 p-2.5 text-xs text-cyan-100">
                      {mafia.detectiveIntel}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Phase Action Card */}
              <div className="madar-glass rounded-2xl p-4 space-y-3.5">
                <p className="text-xs text-slate-200 leading-relaxed">{mafia.nightSummary}</p>

                {mafia.phase === 'NIGHT_ACTION' && (
                  <div className="space-y-3">
                    {needsNightTarget ? (
                      <p className="text-xs text-purple-200">
                        یک بازیکن زنده را از روی میز دایره‌ای انتخاب کن تا اکشن شب نقش ({myRole?.title}) ثبت شود:
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400">
                        شما در این شب استراحت می‌کنید. برای پایان شب و اجرای اکشن خودکار نقش‌ها دکمه زیر را بزنید.
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={busy || (Boolean(needsNightTarget) && !selectedTarget)}
                      onClick={submitNightAction}
                      className="w-full rounded-xl bg-purple-500 py-3 text-xs sm:text-sm font-bold text-white hover:bg-purple-400 disabled:opacity-50 min-h-[46px]"
                    >
                      {busy
                        ? 'در حال پردازش شب...'
                        : needsNightTarget
                          ? 'تأیید هدف شب و طلوع روز'
                          : 'ادامه شب و طلوع روز'}
                    </button>
                  </div>
                )}

                {mafia.phase === 'DAY_DISCUSSION' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={startVoting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 min-h-[46px]"
                  >
                    <Vote className="w-4 h-4" />
                    <span>شروع رأی‌گیری خودکار شهر</span>
                  </button>
                )}

                {mafia.phase === 'VOTING' && (
                  <div className="space-y-2.5">
                    <p className="text-xs text-amber-200">روی نام فرد مشکوک بزن تا رأی خود را ثبت کنی:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {room.players
                        .filter((p) => mafia.aliveIds.includes(p.id))
                        .map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            disabled={busy}
                            onClick={() => castVote(p.id)}
                            className="rounded-xl border border-amber-400/40 bg-[#050816] hover:bg-amber-400 hover:text-slate-950 py-2.5 px-3 text-xs font-semibold text-white transition-colors min-h-[42px]"
                          >
                            رأی به {p.name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {mafia.phase === 'GAME_OVER' && (
                  <div className="text-center space-y-3 py-2">
                    <Trophy className="w-9 h-9 text-amber-400 mx-auto" />
                    <p className="text-base font-bold text-white">
                      {mafia.winner === 'citizens' ? 'پیروزی تیم شهروندان!' : 'پیروزی تیم مافیا!'}
                    </p>
                    <p className="text-xs text-slate-300">نقش واقعی همه بازیکنان روی میز دایره‌ای آشکار شد.</p>
                    <button
                      type="button"
                      onClick={startAutoMafia}
                      className="w-full rounded-xl bg-amber-400 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 min-h-[46px]"
                    >
                      شروع دور جدید مافیا
                    </button>
                  </div>
                )}
              </div>

              {/* Event Log */}
              <div className="rounded-2xl border border-indigo-500/20 bg-[#050816] p-3.5 space-y-2">
                <p className="text-xs font-bold text-slate-400">گزارش گرداننده خودکار</p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto madar-scroll-y">
                  {mafia.log.slice(0, 8).map((ev, idx) => (
                    <div key={idx} className="text-xs text-slate-300 leading-relaxed flex justify-between gap-2">
                      <span>{ev.text}</span>
                      <span className="font-mono text-[10px] text-slate-500 shrink-0">{ev.at}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
