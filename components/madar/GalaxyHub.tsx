'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  Bell,
  Check,
  Crown,
  Flame,
  Heart,
  Mail,
  Moon,
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

export default function GalaxyHub({
  user,
  missions,
  notifications,
  botUsername,
  liteMode,
  onToggleLiteMode,
  onNavigate,
  onClaimMission,
}: GalaxyHubProps) {
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const evolution = user?.planetEvolution ?? {
    stage: 1,
    title: 'زمینِ نوبنیاد',
    subtitle: 'هسته کهکشان تو',
    ringAccent: '#38bdf8',
    auraStyle: 'atmosphere',
    evolutionScore: 0,
    nextStageTitle: 'زمینِ درخشان',
    pointsToNext: 300,
    progressPercent: 10,
  };

  async function handleClaim(id: string) {
    setClaimingId(id);
    try {
      await onClaimMission(id);
    } finally {
      setClaimingId(null);
    }
  }

  async function handleCopyInvite() {
    if (!user) return;
    const url = `https://t.me/${botUsername}?start=${user.referral_code}`;
    try {
      await navigator.clipboard.writeText(url);
      triggerHaptic('light');
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      onNavigate('shop');
    }
  }

  const quickLaunchers = [
    { title: 'دورهمی آنلاین', sub: 'اتاق مشترک دوستان', icon: Users, color: 'text-[#38bdf8]', onClick: () => onNavigate('games', 'hangout') },
    { title: 'حکم چهارنفره', sub: 'پاسور و حاکم', icon: Crown, color: 'text-amber-400', onClick: () => onNavigate('games', 'hokm') },
    { title: 'مافیا خودکار', sub: 'شب و روز آنلاین', icon: Moon, color: 'text-purple-400', onClick: () => onNavigate('games', 'mafia') },
    { title: 'جرئت و حقیقت', sub: 'بطری سه‌بعدی', icon: Flame, color: 'text-rose-400', onClick: () => onNavigate('games', 'truth') },
    { title: 'کوییز زنده', sub: 'سرعت و امتیاز', icon: Zap, color: 'text-cyan-400', onClick: () => onNavigate('games', 'quiz') },
    { title: 'آشنایی ونوس', sub: 'سوایپ و ناشناس', icon: Heart, color: 'text-pink-400', onClick: () => onNavigate('venus') },
    { title: 'نجوای ناشناس', sub: 'لینک پیام محرمانه', icon: Mail, color: 'text-sky-300', onClick: () => onNavigate('whisper') },
    { title: 'مدیریت گروه', sub: 'ضداسپم و تبچی', icon: Shield, color: 'text-emerald-400', onClick: () => onNavigate('saturn') },
  ];

  return (
    <div className="space-y-5 min-w-0">
      {/* Compact Minimal Cosmic Identity Card */}
      <section className="relative overflow-hidden madar-glass rounded-3xl p-4 sm:p-6">
        <div className="pointer-events-none absolute inset-0 madar-starfield opacity-55" />
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
          <div className="md:col-span-7 space-y-4 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-[#38bdf8] font-medium truncate">{evolution.title}</p>
                <h1 className="text-xl sm:text-2xl font-bold text-white mt-0.5 truncate">
                  {user ? `سلام، ${user.display_name}` : 'مدار'}
                </h1>
              </div>
              <button
                type="button"
                onClick={onToggleLiteMode}
                className="rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:text-white shrink-0 min-h-[34px]"
              >
                {liteMode ? 'نمای سه‌بعدی' : 'حالت سبک'}
              </button>
            </div>

            {/* Clean Evolution Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  مرحله <strong className="font-mono text-white">{evolution.stage}</strong> از ۴
                </span>
                <span className="font-mono tabular-nums text-[#38bdf8]">{evolution.evolutionScore} امتیاز</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#0e1621] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-[#38bdf8] to-[#8b5cf6] transition-all duration-500"
                  style={{ width: `${evolution.progressPercent}%` }}
                />
              </div>
            </div>

            {/* Direct Primary Actions */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('games', 'hangout')}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8] px-4 py-3 text-xs sm:text-sm font-bold text-slate-950 hover:brightness-110 min-h-[46px]"
              >
                <Users className="w-4 h-4 shrink-0" />
                <span>دورهمی آنلاین</span>
              </button>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#23303e] bg-[#0e1621] px-4 py-3 text-xs sm:text-sm font-semibold text-slate-100 hover:border-[#38bdf8]/50 min-h-[46px]"
              >
                {copiedInvite ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <UserPlus className="w-4 h-4 text-amber-400 shrink-0" />}
                <span>{copiedInvite ? 'لینک کپی شد' : 'دعوت دوست'}</span>
              </button>
            </div>
          </div>

          {/* Subtle Compact 3D Planet Orb */}
          <div className="md:col-span-5 flex items-center justify-center">
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              aria-label="مشاهده پروفایل"
              className="relative w-44 h-44 sm:w-52 sm:h-52 flex items-center justify-center rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]"
            >
              <CosmicStage3D
                evolutionStage={evolution.stage}
                ringAccent={evolution.ringAccent}
                liteMode={liteMode}
              />
              {liteMode && (
                <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden border border-[#38bdf8]/45">
                  <Image
                    src="/images/madar/earth.jpg"
                    alt="سیاره زمین"
                    fill
                    sizes="128px"
                    referrerPolicy="no-referrer"
                    className="object-cover scale-110"
                  />
                </div>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Clean 2x4 / 4x2 Visual Launcher Grid */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
        {quickLaunchers.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => {
                triggerHaptic('light');
                item.onClick();
              }}
              className="madar-glass rounded-2xl p-3.5 sm:p-4 text-right hover:border-[#38bdf8]/45 transition-colors flex flex-col justify-between gap-3 min-h-[96px]"
            >
              <div className="w-9 h-9 rounded-xl bg-[#0e1621] border border-[#23303e] flex items-center justify-center">
                <Icon className={`w-4 h-4 ${item.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-white truncate">{item.title}</p>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">{item.sub}</p>
              </div>
            </button>
          );
        })}
      </section>

      {/* Compact Missions & Recent Activity (Telegram Settings List Style) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 madar-glass rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>مأموریت‌های امروز</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('shop')}
              className="inline-flex items-center gap-1 text-xs text-[#38bdf8] hover:underline"
            >
              <Store className="w-3.5 h-3.5" />
              <span>فروشگاه</span>
            </button>
          </div>

          <div className="divide-y divide-[#23303e]">
            {missions.slice(0, 4).map((m) => (
              <div key={m.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-semibold text-slate-100 truncate">{m.title}</p>
                  <p className="text-[11px] font-mono tabular-nums text-amber-300 mt-0.5">+{m.reward_stars} ستاره</p>
                </div>
                {m.claimed ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400 shrink-0">
                    <Check className="w-4 h-4" />
                    <span>انجام شد</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={!user || claimingId === m.id}
                    onClick={() => handleClaim(m.id)}
                    className="inline-flex items-center gap-1 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-400 hover:text-slate-950 disabled:opacity-50 shrink-0 min-h-[38px]"
                  >
                    <Star className="w-3.5 h-3.5" />
                    <span>{claimingId === m.id ? '...' : 'دریافت'}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 madar-glass rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#38bdf8]" />
              <span>اعلان‌ها</span>
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-400">{notifications.length}</span>
          </div>

          {notifications.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">اعلان جدیدی نیست.</p>
          ) : (
            <div className="divide-y divide-[#23303e] max-h-56 overflow-y-auto madar-scroll-y">
              {notifications.slice(0, 5).map((n) => (
                <div key={n.id} className="py-2.5 first:pt-0 last:pb-0 space-y-0.5">
                  <p className="text-xs font-semibold text-slate-100">{n.title}</p>
                  <p className="text-[11px] text-slate-400 line-clamp-2">{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
