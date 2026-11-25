'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Award, Check, Copy, Gift, ShoppingBag, Star, Users } from 'lucide-react';
import { triggerHaptic, triggerHapticNotice } from '@/lib/telegram-webapp';
import type { MadarUser } from './types';

interface ShopItem {
  id: string;
  title: string;
  description: string;
  category: string;
  price_stars: number;
  preview_accent: string;
}

interface StarTx {
  id: number;
  amount: number;
  star_bucket: 'free' | 'paid';
  tx_type: string;
  description: string;
  created_at: string;
}

interface RefLeader {
  username: string;
  display_name: string;
  verified_invites: number;
  total_rewards: number;
}

interface StarEconomyProps {
  token: string | null;
  user: MadarUser | null;
  botUsername: string;
  onRefreshUser: () => Promise<void>;
  onRequireAuth: () => void;
}

export default function StarEconomy({
  token,
  user,
  botUsername,
  onRefreshUser,
  onRequireAuth,
}: StarEconomyProps) {
  const [wallet, setWallet] = useState({ freeStars: 0, paidStars: 0, totalStars: 0 });
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [ownedIds, setOwnedIds] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<StarTx[]>([]);
  const [refLeaders, setRefLeaders] = useState<RefLeader[]>([]);
  const [giftTarget, setGiftTarget] = useState('niloofar_art');
  const [giftAmount, setGiftAmount] = useState(15);
  const [copied, setCopied] = useState(false);
  const [txFilter, setTxFilter] = useState<'all' | 'earn' | 'spend'>('all');
  const [notice, setNotice] = useState<string | null>(null);

  const loadEconomy = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/stars', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setWallet(data.wallet);
      setShopItems(data.shopItems || []);
      setOwnedIds(data.ownedIds || []);
      setTransactions(data.transactions || []);
      setRefLeaders(data.referralLeaderboard || []);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await loadEconomy();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadEconomy]);

  if (!token || !user) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-8 text-center space-y-4">
        <h2 className="text-xl font-bold text-white">اقتصاد ستاره، فروشگاه و دعوت دوستان</h2>
        <p className="text-sm text-slate-400">برای مدیریت کیف‌پول ستاره، خرید قاب‌ها و لینک دعوت اختصاصی وارد شوید.</p>
        <button
          type="button"
          onClick={onRequireAuth}
          className="rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-950 min-h-[44px]"
        >
          ورود به حساب مدار
        </button>
      </div>
    );
  }

  const refLink = `https://t.me/${botUsername}?start=${user.referral_code}`;

  async function handleBuy(itemId: string) {
    triggerHaptic('medium');
    const res = await fetch('/api/stars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'buy_item', itemId }),
    });
    const data = await res.json();
    setNotice(data.message || data.error);
    if (res.ok) {
      triggerHapticNotice('success');
      await Promise.all([loadEconomy(), onRefreshUser()]);
    }
  }

  async function handleEquip(item: ShopItem) {
    const payload = item.id.startsWith('frame_')
      ? { equippedFrame: item.id }
      : item.id.startsWith('badge_')
        ? { equippedBadge: item.id }
        : null;
    if (!payload) return;
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setNotice(res.ok ? `آیتم «${item.title}» روی پروفایل تو فعال شد.` : data.error);
    if (res.ok) await onRefreshUser();
  }

  async function handleGift(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/stars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'gift_stars', recipientUsername: giftTarget, amount: Number(giftAmount) }),
    });
    const data = await res.json();
    setNotice(data.message || data.error);
    if (res.ok) {
      await Promise.all([loadEconomy(), onRefreshUser()]);
    }
  }

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(refLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice('لینک دعوت را به‌صورت دستی کپی کنید.');
    }
  }

  return (
    <div className="space-y-6">
      {/* Wallet Overview Strip */}
      <section className="rounded-3xl border border-slate-800 bg-[#0B1022] p-6 grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-2 space-y-2.5">
          <p className="text-xs text-amber-300">کیف پول داخلی ستاره مدار · نسخه ۱ (۱۰۰٪ رایگان و آماده توسعه مالی)</p>
          <h1 className="text-3xl font-bold text-white font-mono tabular-nums">
            {wallet.totalStars.toLocaleString('fa-IR')} <span className="text-base font-sans text-slate-300">ستاره</span>
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>
              دریافتی ثبت‌شده:{' '}
              <strong className="font-mono tabular-nums text-emerald-300">
                +{transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)}
              </strong>
            </span>
            <span>·</span>
            <span>
              خرج‌شده:{' '}
              <strong className="font-mono tabular-nums text-rose-300">
                {transactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)}
              </strong>
            </span>
            <span>·</span>
            <span>
              تراکنش‌ها: <strong className="font-mono tabular-nums text-slate-200">{transactions.length}</strong>
            </span>
            <span>·</span>
            <span>
              اشتراک:{' '}
              <strong className="text-amber-300">
                {user.subscription_tier === 'vip' ? 'مدار VIP' : user.subscription_tier === 'plus' ? 'مدار پلاس' : 'رایگان'}
              </strong>
            </span>
          </div>
        </div>

        <div className="md:col-span-2 flex flex-col justify-center bg-[#070B1A] border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">لینک اختصاصی دعوت دوستان (+۵۰ ستاره پس از ثبت‌نام معتبر)</span>
            <span className="font-mono tabular-nums text-emerald-300">{user.referralCount} دعوت تأییدشده</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono text-amber-200 truncate dir-ltr text-left">{refLink}</code>
            <button
              type="button"
              onClick={copyRef}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/15 border border-amber-400/40 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400 hover:text-slate-950 whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'کپی شد' : 'کپی لینک'}</span>
            </button>
          </div>
        </div>
      </section>

      {notice && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {notice}
        </div>
      )}

      {/* Shop Catalog */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-bold text-white">فروشگاه آیتم‌های فضایی و اشتراک مدار</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shopItems.map((item) => {
            const owned = ownedIds.includes(item.id);
            const isEquipped = user.equipped_frame === item.id || user.equipped_badge === item.id;
            return (
              <div key={item.id} className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{item.category}</span>
                    <span className="font-mono tabular-nums text-amber-300 font-semibold">
                      {item.price_stars} ستاره
                    </span>
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <div
                      className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${item.preview_accent}22`, color: item.preview_accent }}
                    >
                      <Award className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-bold text-white">{item.title}</h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
                </div>

                {owned ? (
                  item.id.startsWith('frame_') || item.id.startsWith('badge_') ? (
                    <button
                      type="button"
                      disabled={isEquipped}
                      onClick={() => handleEquip(item)}
                      className="w-full rounded-xl border border-emerald-400/40 bg-emerald-400/10 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-70 min-h-[42px]"
                    >
                      {isEquipped ? 'فعال روی پروفایل' : 'تنظیم روی پروفایل'}
                    </button>
                  ) : (
                    <div className="text-center text-xs text-emerald-400 py-2">فعال‌شده در حساب</div>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => handleBuy(item.id)}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-300 min-h-[42px]"
                  >
                    <Star className="w-3.5 h-3.5" />
                    <span>خرید با {item.price_stars} ستاره</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Gift Stars + Ledger + Referral Leaderboard */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Gift Form + Referral Table */}
        <div className="lg:col-span-5 space-y-6">
          <form onSubmit={handleGift} className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Gift className="w-4 h-4 text-rose-300" />
              <span>هدیه ستاره به دوستان</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <input
                type="text"
                value={giftTarget}
                onChange={(e) => setGiftTarget(e.target.value)}
                placeholder="نام کاربری"
                className="col-span-2 rounded-xl border border-slate-700 bg-[#070B1A] px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                min={5}
                max={500}
                value={giftAmount}
                onChange={(e) => setGiftAmount(Number(e.target.value))}
                className="rounded-xl border border-slate-700 bg-[#070B1A] px-3 py-2 text-sm font-mono tabular-nums text-white"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl border border-amber-400/50 bg-amber-400/10 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-400 hover:text-slate-950 min-h-[42px]"
            >
              ارسال اتمیک هدیه ستاره
            </button>
          </form>

          <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Users className="w-4 h-4 text-sky-400" />
              <span>برترین معرف‌های مدار</span>
            </div>
            <div className="divide-y divide-slate-800/80">
              {refLeaders.map((r, idx) => (
                <div key={r.username} className="py-2.5 flex items-center justify-between text-xs">
                  <span className="text-slate-200">
                    <span className="font-mono tabular-nums text-slate-500 ml-2">#{idx + 1}</span>
                    {r.display_name}
                  </span>
                  <span className="font-mono tabular-nums text-amber-300">
                    {r.verified_invites} دعوت
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Atomic Transaction Ledger */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">تاریخچه تراکنش‌های کیف‌پول داخلی ستاره</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                ثبت اتمیک سمت سرور (مأموریت، بازی، دعوت دوستان، فروشگاه و هدیه)
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#070B1A] border border-slate-800">
              {[
                { id: 'all', label: 'همه' },
                { id: 'earn', label: 'واریزی‌ها' },
                { id: 'spend', label: 'برداشت‌ها' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTxFilter(f.id as 'all' | 'earn' | 'spend')}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg ${
                    txFilter === f.id ? 'bg-amber-400 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {transactions.filter((tx) => (txFilter === 'earn' ? tx.amount >= 0 : txFilter === 'spend' ? tx.amount < 0 : true)).length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">تراکنشی در این فیلتر ثبت نشده است.</p>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-96 overflow-y-auto">
              {transactions
                .filter((tx) => (txFilter === 'earn' ? tx.amount >= 0 : txFilter === 'spend' ? tx.amount < 0 : true))
                .map((tx) => (
                  <div key={tx.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                    <div>
                      <p className="text-slate-100 font-medium">{tx.description}</p>
                      <p className="text-slate-500 font-mono tabular-nums mt-0.5">
                        #{tx.id} · {tx.created_at.slice(0, 16)} · {tx.tx_type} · {tx.star_bucket === 'paid' ? 'اعتباری' : 'رایگان'}
                      </p>
                    </div>
                    <span
                      className={`font-mono tabular-nums font-bold text-sm ${
                        tx.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
