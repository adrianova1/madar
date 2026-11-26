'use client';

import React, { useState } from 'react';
import {
  Compass,
  Eye,
  Gamepad2,
  Heart,
  Mail,
  Monitor,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  Tablet,
  User,
  Users,
} from 'lucide-react';
import GalaxyHub from './GalaxyHub';
import type { GameSubTab, MainView } from './types';
import {
  PREVIEW_MISSIONS,
  PREVIEW_NOTIFICATIONS,
  PREVIEW_PLANETS,
  PREVIEW_SESSIONS,
  PREVIEW_USER,
  PREVIEW_VENUS_CANDIDATES,
  PREVIEW_WHISPERS,
} from '@/lib/preview-data';

type ViewportMode = 'full' | 'tablet' | 'mobile';

export default function PreviewSandbox() {
  const [view, setView] = useState<MainView>('home');
  const [viewport, setViewport] = useState<ViewportMode>('full');
  const [liteMode, setLiteMode] = useState(false);
  const [user, setUser] = useState(PREVIEW_USER);
  const [missions, setMissions] = useState(PREVIEW_MISSIONS);
  const [venusIndex, setVenusIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<GameSubTab | null>(null);

  function showPreviewNotice(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  function handleNavigate(nextView: MainView, nextGame?: GameSubTab) {
    setView(nextView);
    if (nextView === 'games') {
      setSelectedGame(nextGame ?? null);
    }
  }

  async function handleClaimPreviewMission(missionId: string) {
    setMissions((prev) => prev.map((m) => (m.id === missionId ? { ...m, claimed: true } : m)));
    setUser((prev) => ({ ...prev, totalStars: prev.totalStars + 30, free_stars: prev.free_stars + 30 }));
    showPreviewNotice('در پیش‌نمایش انجام شد (بدون تغییر در دیتابیس واقعی)');
  }

  const navItems: { id: MainView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'home', label: 'خانه', icon: Compass },
    { id: 'games', label: 'بازی‌ها', icon: Gamepad2 },
    { id: 'venus', label: 'ونوس', icon: Heart },
    { id: 'whisper', label: 'نجوا', icon: Mail },
    { id: 'profile', label: 'پروفایل', icon: User },
  ];

  const frameClass =
    viewport === 'mobile'
      ? 'max-w-[390px] mx-auto border-x border-[#23303E] shadow-2xl'
      : viewport === 'tablet'
        ? 'max-w-[768px] mx-auto border-x border-[#23303E] shadow-2xl'
        : 'w-full';

  const currentCandidate = PREVIEW_VENUS_CANDIDATES[venusIndex % PREVIEW_VENUS_CANDIDATES.length];

  return (
    <div className="min-h-[100dvh] bg-[#080d14] text-slate-100 flex flex-col">
      {/* Isolated Dev Preview Control Ribbon */}
      <div className="sticky top-0 z-50 border-b border-amber-400/30 bg-[#131b26] px-3 py-2">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-amber-300 font-semibold">
            <Eye className="w-4 h-4 shrink-0" />
            <span>پیشنمایش توسعه مدار</span>
            <span className="hidden sm:inline text-[11px] font-normal text-slate-400">
              · ایزوله از دیتابیس و غیرفعال در Production
            </span>
          </div>

          <div className="flex items-center gap-1 bg-[#0E1621] border border-[#23303E] rounded-lg p-0.5">
            {[
              { id: 'mobile', label: 'موبایل', icon: Smartphone },
              { id: 'tablet', label: 'تبلت', icon: Tablet },
              { id: 'full', label: 'دسکتاپ', icon: Monitor },
            ].map((vp) => {
              const Icon = vp.icon;
              return (
                <button
                  key={vp.id}
                  type="button"
                  onClick={() => setViewport(vp.id as ViewportMode)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] transition-colors ${
                    viewport === vp.id ? 'bg-[#38BDF8] text-[#0E1621] font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{vp.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Simulated App Frame */}
      <div className={`flex-1 flex flex-col bg-[#0E1621] transition-all ${frameClass}`}>
        <header className="h-[52px] border-b border-[#23303E] bg-[#17212B]/95 px-4 flex items-center justify-between gap-3">
          <button type="button" onClick={() => handleNavigate('home')} className="text-base font-bold text-white">
            مدار
          </button>

          <nav className="hidden md:flex items-center gap-5 text-sm">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={view === item.id ? 'text-[#38BDF8] font-semibold' : 'text-slate-400 hover:text-white'}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLiteMode((v) => !v)}
              className="w-9 h-9 rounded-xl border border-[#23303E] bg-[#0E1621] flex items-center justify-center text-slate-300"
              title="تغییر حالت سه‌بعدی / سبک"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('shop')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400/12 border border-amber-400/35 px-2.5 py-1.5 text-xs font-semibold text-amber-300"
            >
              <Star className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums">{user.totalStars}</span>
            </button>
          </div>
        </header>

        {toast && (
          <div className="mx-4 mt-3 rounded-xl border border-[#38BDF8]/35 bg-[#38BDF8]/10 px-4 py-2.5 text-xs text-sky-200">
            {toast}
          </div>
        )}

        <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-5 py-4 pb-20 md:pb-8 min-w-0">
          {view === 'home' && (
            <GalaxyHub
              user={user}
              planets={PREVIEW_PLANETS}
              missions={missions}
              notifications={PREVIEW_NOTIFICATIONS}
              botUsername="m4d4rbot"
              liteMode={liteMode}
              onToggleLiteMode={() => setLiteMode((v) => !v)}
              onNavigate={handleNavigate}
              onClaimMission={handleClaimPreviewMission}
            />
          )}

          {view === 'games' && (
            <div className="space-y-4">
              <div className="madar-glass rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-lg font-bold text-white">تالار بازی‌های مدار (پیش‌نمایش)</h1>
                  <p className="text-xs text-slate-400 mt-1">
                    نمای انتخاب بازی‌ها بدون منوی تکراری — برای تست طراحی در موبایل و دسکتاپ
                  </p>
                </div>
                {selectedGame && (
                  <button
                    type="button"
                    onClick={() => setSelectedGame(null)}
                    className="rounded-xl border border-[#23303E] bg-[#0E1621] px-3.5 py-2 text-xs text-slate-200"
                  >
                    همه بازی‌ها
                  </button>
                )}
              </div>

              {!selectedGame ? (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'hokm', title: 'حکم آنلاین', desc: '۴ نفره با ورق و تیم‌کشی', color: 'border-sky-500/35' },
                    { id: 'mafia', title: 'مافیا', desc: 'گرداننده خودکار + تایمر سرور', color: 'border-purple-500/35' },
                    { id: 'truth', title: 'جرئت و حقیقت', desc: 'بطری سه‌بعدی و ۵ دسته آزاد', color: 'border-rose-500/35' },
                    { id: 'quiz', title: 'کوییژ سریع', desc: 'رقابت امتیازی با تایمر زنده', color: 'border-amber-500/35' },
                  ].map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGame(g.id as GameSubTab)}
                      className={`madar-glass rounded-2xl p-4 text-right space-y-1.5 border ${g.color} hover:border-[#38BDF8] transition-colors`}
                    >
                      <p className="text-sm sm:text-base font-bold text-white">{g.title}</p>
                      <p className="text-xs text-slate-400">{g.desc}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="madar-glass rounded-2xl p-6 space-y-4">
                  <h2 className="text-base font-bold text-white">پیش‌نمایش میز بازی: {selectedGame}</h2>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    در حالت پیش‌نمایش توسعه، هیچ اتاقی در دیتابیس اصلی ساخته نمی‌شود. برای اجرای زنده با سرور واقعی، مینی‌اپ را از ربات @m4d4rbot باز کنید.
                  </p>
                  <button
                    type="button"
                    onClick={() => showPreviewNotice('عملیات واقعی بازی در حالت Preview غیرفعال است.')}
                    className="rounded-xl bg-[#38BDF8] px-4 py-2.5 text-xs font-bold text-[#0E1621]"
                  >
                    تست دکمه اقدام نمونه
                  </button>
                </div>
              )}
            </div>
          )}

          {view === 'venus' && (
            <div className="max-w-md mx-auto space-y-4">
              <div className="madar-glass rounded-3xl overflow-hidden border border-[#23303E]">
                <div
                  className="h-64 flex flex-col justify-between p-5"
                  style={{
                    background: `linear-gradient(155deg, ${currentCandidate.avatarColor} 0%, #17212B 100%)`,
                  }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="rounded-lg bg-black/40 px-2.5 py-1 text-emerald-300 font-semibold">
                      هم‌سازگاری {currentCandidate.compatibilityScore}%
                    </span>
                    <span className="rounded-lg bg-black/40 px-2.5 py-1 text-slate-200">{currentCandidate.city}</span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">
                      {currentCandidate.displayName}، {currentCandidate.age}
                    </h2>
                    <p className="text-xs text-slate-200 mt-1">{currentCandidate.lookingFor}</p>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-sm text-slate-200 leading-relaxed">{currentCandidate.bio}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {currentCandidate.interests.map((tag) => (
                      <span key={tag} className="rounded-lg bg-[#0E1621] border border-[#23303E] px-2.5 py-1 text-xs text-slate-300">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setVenusIndex((i) => i + 1);
                        showPreviewNotice('رد شد (فقط پیش‌نمایش)');
                      }}
                      className="rounded-xl border border-[#23303E] bg-[#0E1621] py-3 text-xs font-semibold text-slate-200"
                    >
                      بعدی
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setVenusIndex((i) => i + 1);
                        showPreviewNotice('پسندیده شد (فقط پیش‌نمایش)');
                      }}
                      className="rounded-xl bg-rose-500 py-3 text-xs font-bold text-white"
                    >
                      پسندیدن
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'whisper' && (
            <div className="madar-glass rounded-2xl p-5 space-y-4">
              <h1 className="text-base font-bold text-white">نجوای ناشناس نپتون (نمونه)</h1>
              {PREVIEW_WHISPERS.map((w) => (
                <div key={w.id} className="rounded-xl border border-[#23303E] bg-[#0E1621] p-4 space-y-2">
                  <p className="text-sm text-slate-100">{w.content}</p>
                  <p className="text-[11px] text-slate-500">{w.created_at}</p>
                </div>
              ))}
            </div>
          )}

          {view === 'saturn' && (
            <div className="madar-glass rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-white font-bold">
                <Shield className="w-5 h-5 text-[#38BDF8]" />
                <span>مدیریت بومی گروه زحل (پیش‌نمایش)</span>
              </div>
              <p className="text-xs text-slate-400">
                تغییرات واقعی گروه‌های تلگرام در حالت پیش‌نمایش مسدود هستند.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                {['ضدلینک', 'ضدتبلیغ', 'ضدتبچی', 'ضداسپم', 'ضدFlood', 'قفل رسانه'].map((rule) => (
                  <div key={rule} className="rounded-xl border border-[#23303E] bg-[#0E1621] p-3 flex items-center justify-between">
                    <span>{rule}</span>
                    <span className="text-emerald-400 font-semibold">فعال</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'shop' && (
            <div className="madar-glass rounded-2xl p-5 space-y-3">
              <h1 className="text-base font-bold text-white">فروشگاه ستاره‌ها (پیش‌نمایش)</h1>
              <p className="text-xs text-slate-400">عملیات مالی و خرید واقعی در حالت پیش‌نمایش غیرفعال است.</p>
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
                موجودی نمونه: <strong className="font-mono">{user.totalStars}</strong> ستاره
              </div>
            </div>
          )}

          {view === 'profile' && (
            <div className="madar-glass rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-3.5">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold text-white shrink-0"
                  style={{ backgroundColor: user.avatar_color }}
                >
                  {user.avatar_initials}
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-white truncate">{user.display_name}</h1>
                  <p className="text-xs text-slate-400 mt-0.5">
                    @{user.username} · سطح {user.level} · {user.city}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{user.bio}</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-[#23303E] bg-[#0E1621] p-3">
                  <p className="text-slate-400">نشست نمونه</p>
                  <p className="text-slate-100 mt-1">{PREVIEW_SESSIONS[0].device_label}</p>
                </div>
                <div className="rounded-xl border border-[#23303E] bg-[#0E1621] p-3">
                  <p className="text-slate-400 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-emerald-400" />
                    <span>صورت‌فلکی نمونه</span>
                  </p>
                  <p className="text-emerald-300 font-bold mt-1">{user.constellationFriends.length} همراه</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => showPreviewNotice('ذخیره واقعی در حالت Preview غیرفعال است.')}
                className="w-full sm:w-auto rounded-xl bg-[#38BDF8] px-5 py-2.5 text-xs font-bold text-[#0E1621]"
              >
                ذخیره نمونه
              </button>
            </div>
          )}
        </main>

        {/* Bottom Nav for Mobile / Compact Viewports */}
        <nav className="sticky bottom-0 z-40 border-t border-[#23303E] bg-[#17212B]/98 md:hidden">
          <div className="grid grid-cols-5 h-14 items-center">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`flex flex-col items-center justify-center min-h-[44px] ${
                    active ? 'text-[#38BDF8]' : 'text-slate-400'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] mt-0.5">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
