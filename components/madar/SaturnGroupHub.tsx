'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Lock, Save, Send, Shield, ShieldAlert, Terminal } from 'lucide-react';
import type { MadarUser } from './types';

interface TelegramGroup {
  id: number;
  chat_id: string;
  title: string;
  member_count: number;
  bot_is_admin: number;
  anti_link: number;
  anti_ads: number;
  anti_tabchi: number;
  anti_spam: number;
  anti_flood: number;
  lock_media: number;
  sensitivity_level: 'low' | 'medium' | 'strict';
  mute_duration_minutes: number;
  banned_words: string;
  welcome_text: string;
  rules_text: string;
  ai_enabled: number;
}

interface ModLog {
  id: number;
  command: string;
  target_label: string;
  reason: string;
  actor_label: string;
  created_at: string;
}

interface SaturnGroupHubProps {
  token: string | null;
  user: MadarUser | null;
  onRequireAuth: () => void;
}

export default function SaturnGroupHub({ token, user, onRequireAuth }: SaturnGroupHubProps) {
  const [group, setGroup] = useState<TelegramGroup | null>(null);
  const [logs, setLogs] = useState<ModLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [authDeniedMsg, setAuthDeniedMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Live local moderation rule tester
  const [testText, setTestText] = useState('');
  const [testMedia, setTestMedia] = useState(false);
  const [testForwarded, setTestForwarded] = useState(false);
  const [testResult, setTestResult] = useState<{ allowed: boolean; action: string; reason: string; ruleTriggered?: string } | null>(null);

  // Local rule-based group responder (zero external AI)
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'bot'; text: string; meta?: string }[]>([
    {
      role: 'bot',
      text: 'سلام! من موتور محلی مدیریت گروه مدار هستم (بدون وابستگی به API خارجی). دستورهایی مثل «قوانین»، «وضعیت»، «بازی» یا «راهنما» را امتحان کن.',
      meta: 'موتور محلی مدار',
    },
  ]);
  const [promptInput, setPromptInput] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);

  const loadGroups = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setAuthDeniedMsg('برای مدیریت گروه ابتدا از طریق تلگرام وارد حساب خود شوید.');
      return;
    }
    setLoading(true);
    setAuthDeniedMsg(null);
    try {
      const res = await fetch('/api/groups', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthDeniedMsg(data.error || 'دسترسی به تنظیمات گروه مجاز نیست.');
        setGroup(null);
        return;
      }
      const first = (data.groups?.[0] as TelegramGroup | undefined) || null;
      setGroup(first);
      setLogs(data.logs || []);
      if (!first) {
        setAuthDeniedMsg('شما ادمین تاییدشده هیچ گروه متصل‌شده‌ای نیستید. ربات را در گروه تلگرام خود ادمین کنید.');
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await loadGroups();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadGroups]);

  async function saveGroupSettings() {
    if (!group || !token) {
      onRequireAuth();
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          groupId: group.id,
          anti_link: Boolean(group.anti_link),
          anti_ads: Boolean(group.anti_ads),
          anti_tabchi: Boolean(group.anti_tabchi),
          anti_spam: Boolean(group.anti_spam),
          anti_flood: Boolean(group.anti_flood),
          lock_media: Boolean(group.lock_media),
          sensitivity_level: group.sensitivity_level || 'medium',
          mute_duration_minutes: Number(group.mute_duration_minutes || 15),
          banned_words: group.banned_words,
          welcome_text: group.welcome_text,
          rules_text: group.rules_text,
          ai_enabled: Boolean(group.ai_enabled),
        }),
      });
      const data = await res.json();
      setStatusMsg(data.message || data.error);
      if (res.ok) await loadGroups();
    } finally {
      setSaving(false);
    }
  }

  async function runFilterTest(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !token) {
      onRequireAuth();
      return;
    }
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        groupId: group.id,
        action: 'test_message',
        message: testText,
        hasMedia: testMedia,
        isForwarded: testForwarded,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setTestResult(data.decision);
      await loadGroups();
    } else {
      setStatusMsg(data.error || 'خطا در بررسی پیام');
    }
  }

  async function runModCommand(command: '/warn' | '/mute' | '/unmute' | '/ban' | '/lock' | '/clean' | '/rules') {
    if (!group || !token) {
      onRequireAuth();
      return;
    }
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        groupId: group.id,
        action: 'command',
        command,
        targetLabel: 'کاربر آزمایشی گروه',
      }),
    });
    const data = await res.json();
    setStatusMsg(data.output || data.error);
    if (res.ok) await loadGroups();
  }

  async function handleAskLocalBot(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !token || !promptInput.trim() || replyLoading) return;
    const msg = promptInput.trim();
    setChatHistory((prev) => [...prev, { role: 'user', text: msg }]);
    setPromptInput('');
    setReplyLoading(true);

    try {
      const res = await fetch('/api/ai/group-assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ groupId: group.id, message: msg }),
      });
      const data = await res.json();
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'bot',
          text: res.ok ? data.reply : data.error || 'دسترسی مجاز نیست.',
          meta: res.ok ? 'موتور محلی مدار' : 'خطا',
        },
      ]);
    } finally {
      setReplyLoading(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-sm text-slate-400">در حال بررسی دسترسی ادمین گروه...</div>;
  }

  if (!group) {
    return (
      <div className="madar-glass rounded-3xl p-6 sm:p-8 text-center space-y-3 max-w-lg mx-auto">
        <Lock className="w-8 h-8 text-amber-400 mx-auto" />
        <h1 className="text-lg font-bold text-white">مدیریت گروه (زحل)</h1>
        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
          {authDeniedMsg || 'دسترسی به تنظیمات ضداسپم فقط برای ادمین‌های تاییدشده گروه در تلگرام باز است.'}
        </p>
        {!user && (
          <button
            type="button"
            onClick={onRequireAuth}
            className="rounded-xl bg-[#38bdf8] px-5 py-2.5 text-xs font-bold text-slate-950 min-h-[42px]"
          >
            ورود با تلگرام
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[#38bdf8]">موتور ضداسپم، ضدتبچی و مدیریت گروه محلی</p>
          <h1 className="text-xl font-bold text-white mt-0.5 truncate">{group.title}</h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            {group.chat_id} · {group.member_count} عضو
          </p>
        </div>

        <button
          type="button"
          onClick={saveGroupSettings}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#38bdf8] px-5 py-2.5 text-xs sm:text-sm font-bold text-slate-950 hover:brightness-110 min-h-[44px] shrink-0"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}</span>
        </button>
      </div>

      {statusMsg && (
        <div className="rounded-xl border border-amber-400/35 bg-amber-400/10 px-4 py-3 text-xs sm:text-sm text-amber-100 whitespace-pre-line">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Local Moderation Rules */}
        <div className="lg:col-span-6 space-y-5">
          <div className="madar-glass rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Shield className="w-4 h-4 text-[#38bdf8]" />
              <span>سپر محافظت گروه</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { key: 'anti_link', label: 'ضدلینک' },
                { key: 'anti_ads', label: 'ضدتبلیغات' },
                { key: 'anti_tabchi', label: 'ضدتبچی' },
                { key: 'anti_spam', label: 'ضداسپم' },
                { key: 'anti_flood', label: 'ضدفلود' },
                { key: 'lock_media', label: 'قفل رسانه' },
              ].map((item) => {
                const active = Boolean(group[item.key as keyof TelegramGroup]);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() =>
                      setGroup((g) => (g ? { ...g, [item.key]: active ? 0 : 1 } : null))
                    }
                    className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors min-h-[42px] ${
                      active
                        ? 'border-[#38bdf8]/60 bg-[#38bdf8]/12 text-[#38bdf8]'
                        : 'border-[#23303e] bg-[#0e1621] text-slate-400'
                    }`}
                  >
                    <span>{item.label}</span>
                    {active && <Check className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <label className="text-xs text-slate-400 block">سطح حساسیت فلود</label>
                <select
                  value={group.sensitivity_level || 'medium'}
                  onChange={(e) =>
                    setGroup({ ...group, sensitivity_level: e.target.value as 'low' | 'medium' | 'strict' })
                  }
                  className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2.5 text-xs text-white"
                >
                  <option value="low">ملایم (۸ پیام/۱۲ثانیه)</option>
                  <option value="medium">متعادل (۵ پیام/۱۰ثانیه)</option>
                  <option value="strict">سخت‌گیرانه (۳ پیام/۸ثانیه)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400 block">مدت سکوت خودکار (دقیقه)</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={group.mute_duration_minutes || 15}
                  onChange={(e) => setGroup({ ...group, mute_duration_minutes: Number(e.target.value) })}
                  className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2.5 text-xs font-mono text-white"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">کلمات ممنوعه (با کاما)</label>
              <input
                type="text"
                value={group.banned_words}
                onChange={(e) => setGroup({ ...group, banned_words: e.target.value })}
                className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2.5 text-xs text-white"
              />
            </div>

            <div className="pt-2 border-t border-[#23303e] space-y-2">
              <p className="text-xs text-slate-400">فرمان‌های سریع</p>
              <div className="flex flex-wrap gap-1.5">
                {(['/rules', '/warn', '/mute', '/unmute', '/ban', '/lock', '/clean'] as const).map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => runModCommand(cmd)}
                    className="rounded-lg border border-[#23303e] bg-[#0e1621] px-2.5 py-1.5 text-xs font-mono text-[#38bdf8] hover:border-[#38bdf8]"
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Filter Tester */}
          <form onSubmit={runFilterTest} className="madar-glass rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>تست زنده قوانین ضداسپم و تبچی</span>
            </div>
            <input
              type="text"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder="متن نمونه (مثلاً: لینک کانال t.me/test یا پیام تبلیغاتی)..."
              className="w-full rounded-xl border border-[#23303e] bg-[#0e1621] px-3.5 py-2.5 text-base sm:text-sm text-white"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4 text-xs text-slate-300">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={testMedia} onChange={(e) => setTestMedia(e.target.checked)} className="accent-[#38bdf8]" />
                  <span>رسانه</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={testForwarded} onChange={(e) => setTestForwarded(e.target.checked)} className="accent-[#38bdf8]" />
                  <span>فورواردی</span>
                </label>
              </div>
              <button
                type="submit"
                className="rounded-xl border border-[#38bdf8]/45 bg-[#38bdf8]/12 px-4 py-2 text-xs font-bold text-[#38bdf8] hover:bg-[#38bdf8] hover:text-slate-950 min-h-[38px]"
              >
                بررسی
              </button>
            </div>
            {testResult && (
              <div
                className={`rounded-xl p-3 text-xs ${
                  testResult.allowed
                    ? 'bg-emerald-500/12 text-emerald-200 border border-emerald-500/35'
                    : 'bg-rose-500/12 text-rose-200 border border-rose-500/35'
                }`}
              >
                نتیجه: <strong>{testResult.allowed ? 'مجاز' : `مسدود (${testResult.action})`}</strong> — {testResult.reason}
              </div>
            )}
          </form>
        </div>

        {/* Local Rule-Based Responder + Moderation Audit Log */}
        <div className="lg:col-span-6 space-y-5">
          <div className="madar-glass rounded-2xl flex flex-col min-h-[360px]">
            <div className="px-4 py-3.5 border-b border-[#23303e] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-[#38bdf8]" />
                <div>
                  <h2 className="text-sm font-bold text-white">پاسخ‌گوی محلی ربات گروه</h2>
                  <p className="text-[11px] text-slate-400">موتور داخلی بدون سرویس خارجی</p>
                </div>
              </div>
              <span className="text-xs font-mono text-emerald-300">محلی</span>
            </div>

            <div className="flex-1 p-4 space-y-2.5 overflow-y-auto max-h-72 madar-scroll-y">
              {chatHistory.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-[#38bdf8]/15 border border-[#38bdf8]/30 text-sky-100'
                        : 'bg-[#0e1621] border border-[#23303e] text-slate-100'
                    }`}
                  >
                    <p className="whitespace-pre-line">{m.text}</p>
                    {m.meta && <p className="text-[10px] font-mono text-slate-500 mt-1">{m.meta}</p>}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleAskLocalBot} className="p-3 border-t border-[#23303e] flex gap-2">
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="مثلاً: قوانین یا وضعیت..."
                className="flex-1 min-w-0 rounded-xl border border-[#23303e] bg-[#0e1621] px-3 py-2 text-base sm:text-sm text-white focus:border-[#38bdf8] focus:outline-none"
              />
              <button
                type="submit"
                disabled={replyLoading}
                className="inline-flex items-center gap-1 rounded-xl bg-[#38bdf8] px-4 py-2 text-xs font-bold text-slate-950 min-h-[42px]"
              >
                <Send className="w-4 h-4" />
                <span>ارسال</span>
              </button>
            </form>
          </div>

          <div className="madar-glass rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Terminal className="w-4 h-4 text-slate-400" />
              <span>سوابق مدیریت ({logs.length})</span>
            </div>
            <div className="divide-y divide-[#23303e] max-h-44 overflow-y-auto madar-scroll-y">
              {logs.map((l) => (
                <div key={l.id} className="py-2 text-xs flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-amber-300 ml-1.5">{l.command}</span>
                    <span className="text-slate-200">{l.reason}</span>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {l.target_label} · {l.actor_label}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums text-[10px] text-slate-500 shrink-0">
                    {l.created_at.slice(11, 16)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
