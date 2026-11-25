'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Save, Send, Shield, ShieldAlert, Terminal } from 'lucide-react';
import type { MadarUser } from './types';

interface TelegramGroup {
  id: number;
  chat_id: string;
  title: string;
  member_count: number;
  bot_is_admin: number;
  anti_link: number;
  anti_ads: number;
  anti_spam: number;
  anti_flood: number;
  lock_media: number;
  banned_words: string;
  welcome_text: string;
  rules_text: string;
  ai_enabled: number;
  ai_humor_level: 'جدی' | 'متعادل' | 'شوخ‌طبع';
  ai_max_reply_chars: number;
  ai_daily_limit: number;
  ai_used_today: number;
  ai_allowed_topics: string;
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
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Live moderation filter tester
  const [testText, setTestText] = useState('');
  const [testMedia, setTestMedia] = useState(false);
  const [testResult, setTestResult] = useState<{ allowed: boolean; action: string; reason: string } | null>(null);

  // Live Gemini @MadarBot group assistant
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'bot'; text: string; meta?: string }[]>([
    {
      role: 'bot',
      text: 'سلام! من دستیار هوشمند مدار (@MadarBot) هستم. می‌توانید درباره بازی‌ها، سرگرمی، اطلاعات عمومی یا قوانین گروه از من بپرسید.',
      meta: 'Gemini 4 Hydrogen',
    },
  ]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const loadGroups = useCallback(async () => {
    const res = await fetch('/api/groups');
    if (res.ok) {
      const data = await res.json();
      setGroup(data.groups?.[0] || null);
      setLogs(data.logs || []);
    }
  }, []);

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
          anti_spam: Boolean(group.anti_spam),
          anti_flood: Boolean(group.anti_flood),
          lock_media: Boolean(group.lock_media),
          banned_words: group.banned_words,
          welcome_text: group.welcome_text,
          rules_text: group.rules_text,
          ai_enabled: Boolean(group.ai_enabled),
          ai_humor_level: group.ai_humor_level,
          ai_max_reply_chars: Number(group.ai_max_reply_chars),
          ai_daily_limit: Number(group.ai_daily_limit),
          ai_allowed_topics: group.ai_allowed_topics,
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
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setTestResult(data.decision);
      await loadGroups();
    }
  }

  async function runModCommand(command: '/warn' | '/mute' | '/ban' | '/lock' | '/clean' | '/rules') {
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
    if (res.ok) {
      setStatusMsg(data.output);
      await loadGroups();
    }
  }

  async function handleAskGemini(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !aiPrompt.trim() || aiLoading) return;
    const msg = aiPrompt.trim();
    setChatHistory((prev) => [...prev, { role: 'user', text: `@MadarBot ${msg}` }]);
    setAiPrompt('');
    setAiLoading(true);

    try {
      const res = await fetch('/api/ai/group-assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ groupId: group.id, message: msg }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatHistory((prev) => [
          ...prev,
          { role: 'bot', text: data.error || 'خطا در دریافت پاسخ از Gemini.', meta: 'خطای کنترل‌شده' },
        ]);
      } else {
        setChatHistory((prev) => [
          ...prev,
          {
            role: 'bot',
            text: data.reply,
            meta: `${data.model} · سهمیه باقی‌مانده: ${data.remainingQuota}`,
          },
        ]);
        await loadGroups();
      }
    } finally {
      setAiLoading(false);
    }
  }

  if (!group) {
    return <div className="p-8 text-center text-sm text-slate-400">در حال بارگذاری اطلاعات گروه زحل...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs text-amber-300">سیاره زحل · مدیریت گروه تلگرام و هوش مصنوعی</p>
          <h1 className="text-2xl font-bold text-white mt-0.5">{group.title}</h1>
          <p className="text-xs text-slate-400 font-mono tabular-nums mt-1">
            Chat ID: {group.chat_id} · {group.member_count} عضو · مصرف امروز Gemini: {group.ai_used_today}/{group.ai_daily_limit}
          </p>
        </div>

        <button
          type="button"
          onClick={saveGroupSettings}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-300 min-h-[44px] whitespace-nowrap shrink-0"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات زحل'}</span>
        </button>
      </div>

      {statusMsg && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 whitespace-pre-line">
          {statusMsg}
        </div>
      )}

      {/* Split Console: Left = Anti-Spam & Moderation | Right = Live Gemini @MadarBot Assistant */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Moderation & Anti-Spam Panel */}
        <div className="lg:col-span-6 space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Shield className="w-4 h-4 text-amber-400" />
              <span>قوانین محافظت و ضداسپم گروه</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {[
                { key: 'anti_link', label: 'ضدلینک' },
                { key: 'anti_ads', label: 'ضدتبلیغات' },
                { key: 'anti_spam', label: 'ضداسپم' },
                { key: 'anti_flood', label: 'ضدفلود' },
                { key: 'lock_media', label: 'قفل رسانه' },
                { key: 'ai_enabled', label: 'فعال‌سازی Gemini' },
              ].map((item) => {
                const active = Boolean(group[item.key as keyof TelegramGroup]);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() =>
                      setGroup((g) => (g ? { ...g, [item.key]: active ? 0 : 1 } : null))
                    }
                    className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors min-h-[44px] ${
                      active
                        ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
                        : 'border-slate-800 bg-[#070B1A] text-slate-400'
                    }`}
                  >
                    <span>{item.label}</span>
                    {active && <Check className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>

            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-400 block">فیلتر کلمات غیرمجاز (جداشده با کاما)</label>
                <input
                  type="text"
                  value={group.banned_words}
                  onChange={(e) => setGroup({ ...group, banned_words: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 block">سطح شوخ‌طبعی Gemini</label>
                  <select
                    value={group.ai_humor_level}
                    onChange={(e) =>
                      setGroup({ ...group, ai_humor_level: e.target.value as 'جدی' | 'متعادل' | 'شوخ‌طبع' })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3 py-2 text-xs text-white"
                  >
                    <option value="جدی">جدی و دقیق</option>
                    <option value="متعادل">متعادل و دوستانه</option>
                    <option value="شوخ‌طبع">شوخ‌طبع و سرگرم‌کننده</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 block">سقف درخواست روزانه AI</label>
                  <input
                    type="number"
                    min={10}
                    max={500}
                    value={group.ai_daily_limit}
                    onChange={(e) => setGroup({ ...group, ai_daily_limit: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3 py-2 text-xs font-mono tabular-nums text-white"
                  />
                </div>
              </div>
            </div>

            {/* Quick Telegram Admin Commands */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <p className="text-xs text-slate-400">فرمان‌های سریع مدیریت گروه</p>
              <div className="flex flex-wrap gap-2">
                {(['/rules', '/warn', '/mute', '/ban', '/lock', '/clean'] as const).map((cmd) => (
                  <button
                    key={cmd}
                    type="button"
                    onClick={() => runModCommand(cmd)}
                    className="rounded-lg border border-slate-700 bg-[#070B1A] px-3 py-1.5 text-xs font-mono text-sky-300 hover:border-sky-400"
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Anti-Spam Filter Tester */}
          <form onSubmit={runFilterTest} className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <ShieldAlert className="w-4 h-4 text-rose-300" />
              <span>آزمایش زنده موتور ضداسپم و ضدلینک</span>
            </div>
            <input
              type="text"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder="متن پیام نمونه (مثلاً: عضو کانال ما شوید t.me/test)..."
              className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3.5 py-2.5 text-sm text-white"
            />
            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={testMedia}
                  onChange={(e) => setTestMedia(e.target.checked)}
                  className="accent-amber-400"
                />
                <span>شامل فایل رسانه (عکس/ویدیو)</span>
              </label>
              <button
                type="submit"
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-white hover:border-amber-400 min-h-[40px]"
              >
                بررسی پیام
              </button>
            </div>
            {testResult && (
              <div
                className={`rounded-xl p-3 text-xs ${
                  testResult.allowed
                    ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40'
                    : 'bg-rose-500/15 text-rose-200 border border-rose-500/40'
                }`}
              >
                نتیجه: <strong>{testResult.allowed ? 'مجاز' : `مسدود (${testResult.action})`}</strong> — {testResult.reason}
              </div>
            )}
          </form>
        </div>

        {/* Right Column: Live Gemini AI Group Assistant + Moderation Log */}
        <div className="lg:col-span-6 space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#0B1022] flex flex-col min-h-[420px]">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-sky-400" />
                <div>
                  <h2 className="text-sm font-bold text-white">دستیار هوشمند گروه (@MadarBot)</h2>
                  <p className="text-[11px] text-slate-400">متصل به Gemini API سمت سرور · بدون افشای داده‌های خصوصی</p>
                </div>
              </div>
              <span className="text-xs font-mono tabular-nums text-sky-300">
                {group.ai_enabled ? 'فعال' : 'غیرفعال'}
              </span>
            </div>

            <div className="flex-1 p-5 space-y-3 overflow-y-auto max-h-80">
              {chatHistory.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-amber-400/15 border border-amber-400/30 text-amber-100'
                        : 'bg-[#070B1A] border border-slate-800 text-slate-100'
                    }`}
                  >
                    <p className="whitespace-pre-line">{m.text}</p>
                    {m.meta && <p className="text-[10px] font-mono text-slate-500 mt-1.5">{m.meta}</p>}
                  </div>
                </div>
              ))}
              {aiLoading && <p className="text-xs text-sky-300 text-left">مدار در حال پاسخ‌گویی با Gemini...</p>}
            </div>

            <form onSubmit={handleAskGemini} className="p-3.5 border-t border-slate-800 flex gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="مثلاً: یک بازی گروهی پیشنهاد بده یا یک لطیفه فضایی بگو..."
                className="flex-1 rounded-xl border border-slate-700 bg-[#070B1A] px-3.5 py-2.5 text-sm text-white focus:border-sky-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={aiLoading}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50 min-h-[44px]"
              >
                <Send className="w-4 h-4" />
                <span>ارسال</span>
              </button>
            </form>
          </div>

          {/* Moderation Audit Log */}
          <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Terminal className="w-4 h-4 text-slate-400" />
              <span>سوابق مدیریتی زحل ({logs.length})</span>
            </div>
            <div className="divide-y divide-slate-800/80 max-h-48 overflow-y-auto">
              {logs.map((l) => (
                <div key={l.id} className="py-2.5 text-xs flex items-start justify-between gap-3">
                  <div>
                    <span className="font-mono text-amber-300 ml-2">{l.command}</span>
                    <span className="text-slate-200">{l.reason}</span>
                    <p className="text-slate-500 mt-0.5">{l.target_label} · توسط {l.actor_label}</p>
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
