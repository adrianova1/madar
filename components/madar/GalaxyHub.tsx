'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Award,
  Bell,
  Check,
  Compass,
  Copy,
  Gamepad2,
  Shield,
  Sparkles,
  Star,
  Store,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import { triggerHaptic } from '@/lib/telegram-webapp';
import CosmicStage3D from './CosmicStage3D';
import type { GameSubTab, MadarUser, MainView, MissionItem, NotificationItem, PlanetConfig } from './types';

interface GalaxyHubProps {
  user: MadarUser | null;
  planets: PlanetConfig[];
  missions: MissionItem[];
  notifications: NotificationItem[];
  botUsername: string;
  liteMode: boolean;
  onToggleLiteMode: () => void;
  onNavigate: (view: MainView, gameTab?: GameSubTab) => void;
  onClaimMission: (missionId: string) => Promise<void>;
}

const ORBIT_COORDS: Record<string, { x: number; y: number; size: string }> = {
  venus: { x: 84, y: 24, size: 'w-14 h-14 sm:w-18 sm:h-18' },
  mars: { x: 16, y: 22, size: 'w-13 h-13 sm:w-15 sm:h-15' },
  jupiter: { x: 86, y: 69, size: 'w-14 h-14 sm:w-18 sm:h-18' },
  neptune: { x: 14, y: 69, size: 'w-14 h-14 sm:w-18 sm:h-18' },
  mercury: { x: 50, y: 9, size: 'w-12 h-12 sm:w-14 sm:h-14' },
  saturn: { x: 50, y: 91, size: 'w-13 h-13 sm:w-15 sm:h-15' },
};

const FRIEND_ORBIT_SLOTS = [
  { x: 34, y: 36 },
  { x: 66, y: 36 },
  { x: 68, y: 64 },
  { x: 32, y: 64 },
  { x: 50, y: 29 },
  { x: 50, y: 71 },
];

export default function GalaxyHub({
  user,
  planets,
  missions,
  notifications,
  botUsername,
  liteMode,
  onToggleLiteMode,
  onNavigate,
  onClaimMission,
}: GalaxyHubProps) {
  const [selectedPlanetId, setSelectedPlanetId] = useState<string>('earth');
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const earth = planets.find((p) => p.id === 'earth') || {
    id: 'earth',
    name: 'زمین',
    subtitle: 'سیاره مرکزی و هویت کهکشانی تو',
    target: 'profile',
    color: '#38bdf8',
    image: '/images/madar/earth.jpg',
  };
  const orbitPlanets = planets.filter((p) => p.id !== 'earth');
  const activePlanet = planets.find((p) => p.id === selectedPlanetId) || earth;

  const evolution = user?.planetEvolution ?? {
    stage: 1,
    title: 'زمینِ نوبنیاد',
    subtitle: 'هسته آرام کهکشان شخصی تو',
    ringAccent: '#38bdf8',
    auraStyle: 'atmosphere',
    evolutionScore: 0,
    nextStageTitle: 'زمینِ درخشان',
    pointsToNext: 300,
    progressPercent: 10,
  };

  const constellationFriends = user?.constellationFriends ?? [];
  const earnedBadges = user?.earnedBadges ?? [];

  function openPlanetTarget(target: string) {
    triggerHaptic('medium');
    if (target.startsWith('games:')) {
      const sub = target.split(':')[1] as GameSubTab;
      onNavigate('games', sub);
      return;
    }
    if (
      target === 'venus' ||
      target === 'games' ||
      target === 'whisper' ||
      target === 'profile' ||
      target === 'saturn' ||
      target === 'shop' ||
      target === 'admin'
    ) {
      onNavigate(target);
    } else {
      onNavigate('profile');
    }
  }

  async function handleClaim(id: string) {
    setClaimingId(id);
    try {
      await onClaimMission(id);
    } finally {
      setClaimingId(null);
    }
  }

  async function handleCopyConstellationInvite() {
    if (!user) {
      onNavigate('profile');
      return;
    }
    const url = `https://t.me/${botUsername}?start=${user.referral_code}`;
    try {
      await navigator.clipboard.writeText(url);
      triggerHaptic('light');
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2200);
    } catch {
      onNavigate('shop');
    }
  }

  return (
    <div className="space-y-7 min-w-0">
      {/* Main Cosmic Observatory — Deep Navy + Purple + Electric Blue + Three.js Stage */}
      <section className="relative overflow-hidden rounded-3xl border border-indigo-500/30 bg-[#060a1c] shadow-[0_20px_60px_rgba(2,6,23,0.75)]">
        {/* Multi-layer starfield backdrop */}
        <div className="pointer-events-none absolute inset-0 madar-starfield opacity-70" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-[#050816]/95 via-[#110c2d]/55 to-[#061835]/80" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-7 p-4 sm:p-7 lg:p-10 items-center">
          {/* Right Column (RTL first): Cosmic Identity & Primary Controls */}
          <div className="lg:col-span-5 space-y-5 min-w-0">
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-cyan-300 tracking-wide">
                کهکشان شخصی تو در مدار · {evolution.title}
              </p>
              <h1 className="text-2xl sm:text-4xl font-bold leading-tight text-white text-balance">
                {user ? `منظومه ${user.display_name}` : 'جهان کیهانی مدار'}
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
                زمین، هسته هویت کهکشانی توست؛ در اتاق دورهمی آنلاین با دوستانت حکم، مافیای خودکار و بطری سه‌بعدی بازی کن یا در ونوس آشنایی ناشناس را تجربه کن.
              </p>
            </div>

            {/* Primary Dual CTA Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onNavigate('games', 'hangout')}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-cyan-400 to-blue-500 px-4 py-3 text-sm font-bold text-slate-950 hover:brightness-110 transition-all min-h-[48px] shadow-lg shadow-cyan-500/20"
              >
                <Gamepad2 className="w-4 h-4 shrink-0" />
                <span>ورود به دورهمی آنلاین</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('venus')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-purple-400/45 bg-purple-500/15 px-4 py-3 text-sm font-semibold text-purple-100 hover:bg-purple-500/25 transition-colors min-h-[48px]"
              >
                <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                <span>ونوس و آشنایی ناشناس</span>
              </button>
            </div>

            {/* Cosmic Identity & Evolution Progress */}
            <div className="madar-glass-cyan rounded-2xl p-4 sm:p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-cyan-300/90">تکامل سیاره شخصی</p>
                  <p className="text-sm font-bold text-white mt-0.5 truncate">
                    مرحله <span className="font-mono tabular-nums text-amber-300">{evolution.stage}</span> از ۴ · {evolution.title}
                  </p>
                </div>
                <div className="text-left shrink-0">
                  <p className="text-[11px] text-slate-400">امتیاز کهکشانی</p>
                  <p className="text-sm font-mono tabular-nums font-bold text-cyan-300">{evolution.evolutionScore}</p>
                </div>
              </div>

              <div className="h-2 rounded-full bg-slate-900/90 overflow-hidden border border-cyan-500/20">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-gradient-to-l from-amber-400 via-cyan-400 to-purple-500"
                  style={{ width: `${evolution.progressPercent}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                <span>
                  {evolution.nextStageTitle
                    ? `${evolution.pointsToNext} امتیاز تا «${evolution.nextStageTitle}»`
                    : 'بالاترین سطح تکامل کیهانی فعال شد'}
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <Users className="w-3.5 h-3.5" />
                  <strong className="font-mono tabular-nums">{constellationFriends.length}</strong> همراه مدار
                </span>
              </div>

              {earnedBadges.length > 0 && (
                <div className="pt-2.5 border-t border-cyan-500/15 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-300">
                  <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  {earnedBadges.map((b, idx) => (
                    <span key={b.id} className="text-slate-100">
                      {b.title}
                      {idx < earnedBadges.length - 1 && <span className="text-slate-600 mr-3">·</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Active Planet Focus Panel */}
            <div className="madar-glass rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-400">سیاره انتخاب‌شده</p>
                  <h2 className="text-base sm:text-lg font-bold text-white mt-0.5 truncate">{activePlanet.name}</h2>
                  <p className="text-xs text-slate-300 mt-0.5 line-clamp-2">{activePlanet.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => openPlanetTarget(activePlanet.target)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
                >
                  <span>ورود</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-indigo-500/20 text-xs">
                <button
                  type="button"
                  onClick={handleCopyConstellationInvite}
                  className="inline-flex items-center gap-1.5 text-emerald-300 hover:text-emerald-200 cursor-pointer min-h-[36px]"
                >
                  {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                  <span>{copiedInvite ? 'لینک دعوت کپی شد (+۵۰ ستاره)' : 'دعوت دوست به منظومه'}</span>
                </button>
                <button
                  type="button"
                  onClick={onToggleLiteMode}
                  className="text-cyan-300 hover:text-cyan-200 underline underline-offset-4 cursor-pointer min-h-[36px]"
                >
                  {liteMode ? 'فعال‌سازی سه‌بعدی کامل' : 'سوئیچ به حالت سبک'}
                </button>
              </div>
            </div>
          </div>

          {/* Left Column: 3D Three.js Planetary Stage + Interactive Orbital Navigation */}
          <div className="lg:col-span-7 flex flex-col items-center justify-center gap-4 min-w-0">
            <div className="relative w-full max-w-[520px] aspect-square mx-auto select-none">
              {/* Real Three.js 3D Central Planet & Rings (never covered by backdrop-filter) */}
              <CosmicStage3D
                evolutionStage={evolution.stage}
                ringAccent={evolution.ringAccent}
                liteMode={liteMode}
              />

              {/* Crisp orbital reference rings */}
              <div className="pointer-events-none absolute inset-[8%] rounded-full border border-cyan-400/20" />
              <div className="pointer-events-none absolute inset-[21%] rounded-full border border-dashed border-purple-400/25" />

              {/* Central Earth Interactive Hotzone */}
              <button
                type="button"
                onClick={() => {
                  setSelectedPlanetId(earth.id);
                  openPlanetTarget(earth.target);
                }}
                onMouseEnter={() => setSelectedPlanetId(earth.id)}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center justify-center w-32 h-32 sm:w-40 sm:h-40 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer"
                aria-label="ورود به پروفایل و هویت کهکشانی زمین"
              >
                {liteMode && (
                  <div className="relative w-24 h-24 sm:w-32 sm:h-32 rounded-full overflow-hidden border-2 border-cyan-400/60 shadow-[0_0_35px_rgba(34,211,238,0.28)]">
                    <Image
                      src="/images/madar/earth.jpg"
                      alt="سیاره زمین"
                      fill
                      sizes="140px"
                      referrerPolicy="no-referrer"
                      className="object-cover scale-110"
                    />
                  </div>
                )}
                <span className="mt-auto px-2.5 py-0.5 rounded-md bg-[#050816]/85 border border-cyan-400/35 text-xs font-bold text-white shadow">
                  {earth.name} · مرحله {evolution.stage}
                </span>
              </button>

              {/* Orbiting Invited Friends (Constellation Satellites) */}
              {constellationFriends.slice(0, 6).map((friend, idx) => {
                const slot = FRIEND_ORBIT_SLOTS[idx];
                if (!slot) return null;
                return (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => onNavigate('shop')}
                    title={`${friend.display_name} (@${friend.username})`}
                    style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center group cursor-pointer"
                  >
                    <div
                      className="w-8 h-8 rounded-full border border-emerald-300/80 flex items-center justify-center text-[11px] font-bold text-white shadow-[0_0_16px_rgba(52,211,153,0.35)] group-hover:scale-110 transition-transform"
                      style={{ backgroundColor: friend.avatar_color }}
                    >
                      {friend.avatar_initials}
                    </div>
                    <span className="mt-0.5 text-[10px] text-emerald-200 whitespace-nowrap bg-[#050816]/90 px-1 rounded">
                      {friend.display_name.split(' ')[0]}
                    </span>
                  </button>
                );
              })}

              {/* Orbiting Interactive Destination Planets */}
              {orbitPlanets.map((planet) => {
                const pos = ORBIT_COORDS[planet.id] || { x: 50, y: 15, size: 'w-14 h-14' };
                const isSelected = selectedPlanetId === planet.id;
                return (
                  <motion.button
                    key={planet.id}
                    type="button"
                    onClick={() => {
                      setSelectedPlanetId(planet.id);
                      openPlanetTarget(planet.target);
                    }}
                    onMouseEnter={() => setSelectedPlanetId(planet.id)}
                    whileHover={liteMode ? undefined : { scale: 1.09 }}
                    whileTap={{ scale: 0.94 }}
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-2xl p-1 ${
                      liteMode ? '' : 'animate-float-gentle'
                    }`}
                  >
                    <div
                      className={`relative ${pos.size} rounded-full overflow-hidden border-2 transition-all flex items-center justify-center ${
                        isSelected
                          ? 'border-amber-400 shadow-[0_0_26px_rgba(245,158,11,0.45)]'
                          : 'border-cyan-400/35 group-hover:border-cyan-300'
                      }`}
                      style={
                        planet.image
                          ? undefined
                          : {
                              background: `radial-gradient(circle at 32% 28%, #ffffff40, ${planet.color} 45%, #070b1d 92%)`,
                            }
                      }
                    >
                      {planet.image ? (
                        <Image
                          src={planet.image}
                          alt={`سیاره ${planet.name}`}
                          fill
                          sizes="80px"
                          referrerPolicy="no-referrer"
                          className="object-cover scale-110"
                        />
                      ) : (
                        <span className="text-xs font-bold text-white drop-shadow">{planet.name}</span>
                      )}
                    </div>
                    <span className="mt-1 px-1.5 py-0.5 rounded bg-[#050816]/85 text-[11px] font-semibold text-slate-100 whitespace-nowrap">
                      {planet.name}
                    </span>
                  </motion.button>
                );
              })}
            </div>

            {/* Touch-safe Horizontal Quick Planet Rail for Mobile & Desktop */}
            <div className="w-full max-w-[540px] madar-scroll-x">
              <div className="inline-flex items-center gap-2 py-1 px-1">
                {[
                  { label: 'حکم پاسور', target: 'games:hokm', accent: 'text-amber-300 border-amber-400/35' },
                  { label: 'مافیا خودکار', target: 'games:mafia', accent: 'text-purple-200 border-purple-400/35' },
                  { label: 'بطری سه‌بعدی', target: 'games:truth', accent: 'text-cyan-200 border-cyan-400/35' },
                  { label: 'کوییز زنده', target: 'games:quiz', accent: 'text-sky-200 border-sky-400/35' },
                  { label: 'زحل (گروه)', target: 'saturn', accent: 'text-indigo-200 border-indigo-400/35' },
                  { label: 'فروشگاه ستاره', target: 'shop', accent: 'text-amber-200 border-amber-400/35' },
                ].map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => openPlanetTarget(q.target)}
                    className={`rounded-xl border bg-[#070c22] px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 min-h-[40px] hover:bg-white/5 transition-colors ${q.accent}`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Secondary Utility Access Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <button
          type="button"
          onClick={() => onNavigate('saturn')}
          className="madar-glass rounded-2xl p-4 text-right hover:border-purple-400/50 transition-colors flex items-center justify-between gap-3 min-h-[68px]"
        >
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-bold text-white">زحل · مدیریت گروه و هوش مصنوعی</p>
            <p className="text-xs text-slate-400 truncate">ضداسپم، خوش‌آمدگویی و دستیار Gemini</p>
          </div>
          <Shield className="w-5 h-5 text-purple-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('shop')}
          className="madar-glass rounded-2xl p-4 text-right hover:border-amber-400/50 transition-colors flex items-center justify-between gap-3 min-h-[68px]"
        >
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-bold text-white">کیف‌پول ستاره و کلکسیون</p>
            <p className="text-xs text-slate-400 truncate">قاب‌های کهکشانی، بوستر و لینک دعوت</p>
          </div>
          <Store className="w-5 h-5 text-amber-400 shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('admin')}
          className="madar-glass rounded-2xl p-4 text-right hover:border-cyan-400/50 transition-colors flex items-center justify-between gap-3 min-h-[68px]"
        >
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-bold text-white">پنل مدیریت و نظارت مدار</p>
            <p className="text-xs text-slate-400 truncate">مدیریت محتوای ۱۸+، گزارش‌ها و آمار</p>
          </div>
          <Compass className="w-5 h-5 text-cyan-400 shrink-0" />
        </button>
      </section>

      {/* Daily Missions & Notifications */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 madar-glass rounded-2xl p-4 sm:p-6 space-y-5 min-w-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">مأموریت‌های روزانه و پاداش ستاره</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                با هر مأموریت و بازی، ستاره رایگان بگیر و سیاره‌ات را ارتقا بده
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyConstellationInvite}
              className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:text-amber-200 whitespace-nowrap shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedInvite ? 'کپی شد' : 'دعوت دوست'}</span>
            </button>
          </div>

          <div className="divide-y divide-indigo-500/15">
            {missions.map((m) => (
              <div key={m.id} className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100">
                    <span>{m.title}</span>
                    <span className="text-xs font-mono tabular-nums text-amber-300">+{m.reward_stars} ستاره</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{m.description}</p>
                </div>

                {m.claimed ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400 whitespace-nowrap shrink-0">
                    <Check className="w-4 h-4" />
                    <span>دریافت شد</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={!user || claimingId === m.id}
                    onClick={() => handleClaim(m.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400 hover:text-slate-950 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 min-h-[42px]"
                  >
                    <Star className="w-3.5 h-3.5" />
                    <span>{claimingId === m.id ? '...' : 'دریافت'}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 madar-glass rounded-2xl p-4 sm:p-6 space-y-5 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-cyan-400" />
              <h2 className="text-base sm:text-lg font-bold text-white">اعلان‌های مدار</h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400">{notifications.length} مورد</span>
          </div>

          {notifications.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">هنوز اعلان تازه‌ای ثبت نشده است.</p>
          ) : (
            <div className="divide-y divide-indigo-500/15 max-h-64 overflow-y-auto madar-scroll-y pl-1">
              {notifications.slice(0, 6).map((n) => (
                <div key={n.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-100">{n.title}</p>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                      {n.created_at.slice(0, 10)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{n.body}</p>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-indigo-500/20 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onNavigate('games', 'truth')}
              className="flex items-center gap-1.5 text-xs font-medium text-cyan-300 hover:text-cyan-200 min-h-[40px]"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>بطری سه‌بعدی جرئت و حقیقت</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('venus')}
              className="flex items-center gap-1.5 text-xs font-medium text-rose-300 hover:text-rose-200 min-h-[40px]"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>آشنایی ناشناس ونوس</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
