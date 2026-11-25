'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Ban, Check, Copy, Flag, Lock, MessageSquarePlus, Reply, Send } from 'lucide-react';
import { triggerHaptic } from '@/lib/telegram-webapp';
import type { MadarUser } from './types';

interface InboxWhisper {
  id: number;
  sender_alias: string;
  message: string;
  reply_text: string | null;
  two_way_accepted: number;
  source: string;
  created_at: string;
}

interface SentWhisper {
  id: number;
  message: string;
  reply_text: string | null;
  two_way_accepted: number;
  recipient_name: string;
  recipient_username: string;
  created_at: string;
}

interface DirUser {
  username: string;
  display_name: string;
  anon_slug: string;
  avatar_initials: string;
  avatar_color: string;
}

interface NeptuneWhisperProps {
  token: string | null;
  user: MadarUser | null;
  botUsername: string;
  onRequireAuth: () => void;
}

export default function NeptuneWhisper({ token, user, botUsername, onRequireAuth }: NeptuneWhisperProps) {
  const [inbox, setInbox] = useState<InboxWhisper[]>([]);
  const [sent, setSent] = useState<SentWhisper[]>([]);
  const [directory, setDirectory] = useState<DirUser[]>([]);
  const [recipientSlug, setRecipientSlug] = useState('');
  const [alias, setAlias] = useState('ستاره ناشناس');
  const [messageText, setMessageText] = useState('');
  const [sourceMode, setSourceMode] = useState<'mini_app' | 'group_whisper'>('mini_app');
  const [replyTargetId, setReplyTargetId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [acceptTwoWay, setAcceptTwoWay] = useState(true);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadWhispers = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/whispers', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setInbox(data.inbox || []);
      setSent(data.sent || []);
      setDirectory(data.directory || []);
      if (!recipientSlug && data.directory?.[0]?.anon_slug) {
        setRecipientSlug(data.directory[0].anon_slug);
      }
    }
  }, [token, recipientSlug]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (active) await loadWhispers();
    };
    void run();
    return () => {
      active = false;
    };
  }, [loadWhispers]);

  if (!token || !user) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-8 text-center space-y-4">
        <h2 className="text-xl font-bold text-white">نپتون · نجوا و پیام ناشناس</h2>
        <p className="text-sm text-slate-400">برای دریافت لینک اختصاصی پیام ناشناس و مدیریت صندوق نجوا وارد شوید.</p>
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

  const personalLink = `https://t.me/${botUsername}?start=anon_${user.anon_slug}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(personalLink);
      setCopied(true);
      triggerHaptic('light');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFeedback('کپی خودکار در دسترس نیست؛ لینک را دستی کپی کنید.');
    }
  }

  async function handleSendWhisper(e: React.FormEvent) {
    e.preventDefault();
    if (!recipientSlug.trim() || !messageText.trim()) return;
    triggerHaptic('medium');
    const res = await fetch('/api/whispers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'send',
        recipientSlug,
        message: messageText,
        alias,
        source: sourceMode,
      }),
    });
    const data = await res.json();
    setFeedback(data.message || data.error);
    if (res.ok) {
      setMessageText('');
      await loadWhispers();
    }
  }

  async function handleReply(whisperId: number) {
    if (!replyText.trim()) return;
    const res = await fetch('/api/whispers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'reply',
        whisperId,
        replyText,
        acceptTwoWay,
      }),
    });
    const data = await res.json();
    setFeedback(data.message || data.error);
    if (res.ok) {
      setReplyTargetId(null);
      setReplyText('');
      await loadWhispers();
    }
  }

  async function handleModerateWhisper(whisperId: number, action: 'block' | 'report') {
    const res = await fetch('/api/whispers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(
        action === 'block'
          ? { action: 'block', whisperId }
          : { action: 'report', whisperId, reason: 'گزارش مزاحمت یا پیام نامناسب در نجوای نپتون' }
      ),
    });
    const data = await res.json();
    setFeedback(data.message || data.error);
    await loadWhispers();
  }

  return (
    <div className="space-y-6">
      {/* Header + Personal Anonymous Link */}
      <div className="rounded-3xl border border-slate-800 bg-[#0B1022] p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Image
            src="/images/madar/neptune.jpg"
            alt="سیاره نپتون"
            width={64}
            height={64}
            referrerPolicy="no-referrer"
            className="w-16 h-16 rounded-full object-cover border border-cyan-400/40 shrink-0"
          />
          <div>
            <h1 className="text-2xl font-bold text-white">نپتون · نجوا و پیام ناشناس</h1>
            <p className="text-xs text-slate-400 mt-1">
              لینک اختصاصی پیام ناشناس در تلگرام و مینی‌اپ، با پاسخ ناشناس و حفاظت کامل در برابر آزار
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 bg-[#070B1A] border border-slate-800 rounded-2xl p-3">
          <div className="px-2">
            <p className="text-[11px] text-slate-400">لینک اختصاصی دریافت پیام ناشناس تو</p>
            <p className="text-xs font-mono text-cyan-300 mt-0.5 dir-ltr text-left">{personalLink}</p>
          </div>
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-400/15 border border-cyan-400/40 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400 hover:text-slate-950 transition-colors min-h-[42px] whitespace-nowrap shrink-0"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'کپی شد' : 'کپی لینک'}</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Send Anonymous Whisper Composer */}
        <form
          onSubmit={handleSendWhisper}
          className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0B1022] p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base font-bold text-white">
              <MessageSquarePlus className="w-4 h-4 text-cyan-300" />
              <span>ارسال نجوای ناشناس</span>
            </div>
            <div className="flex items-center gap-1 bg-[#070B1A] p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setSourceMode('mini_app')}
                className={`px-2.5 py-1 text-[11px] rounded-md ${sourceMode === 'mini_app' ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400'}`}
              >
                پی‌وی / مینی‌اپ
              </button>
              <button
                type="button"
                onClick={() => setSourceMode('group_whisper')}
                className={`px-2.5 py-1 text-[11px] rounded-md ${sourceMode === 'group_whisper' ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400'}`}
              >
                نجوا در گروه
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 block">گیرنده (نام کاربری یا انتخاب سریع)</label>
            <input
              type="text"
              value={recipientSlug}
              onChange={(e) => setRecipientSlug(e.target.value)}
              placeholder="مثلاً niloofar_art"
              className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3.5 py-2.5 text-sm text-white focus:border-cyan-400 focus:outline-none"
            />
            {directory.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {directory.slice(0, 5).map((u) => (
                  <button
                    key={u.username}
                    type="button"
                    onClick={() => setRecipientSlug(u.anon_slug)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      recipientSlug === u.anon_slug
                        ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-200'
                        : 'border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {u.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 block">نام مستعار نمایشی (هویت واقعی تو مخفی می‌ماند)</label>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              maxLength={30}
              className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3.5 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 block">متن نجوا</label>
            <textarea
              rows={4}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              maxLength={500}
              placeholder="حرف دلت را محترمانه و ناشناس بنویس..."
              className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3.5 py-2.5 text-sm text-white focus:border-cyan-400 focus:outline-none resize-none"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <Lock className="w-3.5 h-3.5 text-cyan-300" />
              <span>هویت فرستنده در UI افشا نمی‌شود</span>
            </span>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-300 min-h-[44px]"
            >
              <Send className="w-4 h-4" />
              <span>ارسال ناشناس</span>
            </button>
          </div>
        </form>

        {/* Inbox & Sent Threads */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">صندوق نجواهای دریافتی ({inbox.length})</h2>
              <span className="text-xs text-slate-400">پاسخ ناشناس + مسدودسازی امن</span>
            </div>

            {inbox.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">
                هنوز نجوای ناشناسی دریافت نکرده‌ای. لینک اختصاصی‌ات را در تلگرام به اشتراک بگذار!
              </p>
            ) : (
              <div className="divide-y divide-slate-800">
                {inbox.map((w) => (
                  <div key={w.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>
                        از طرف: <strong className="text-cyan-200 font-medium">{w.sender_alias}</strong> ·{' '}
                        {w.source === 'group_whisper' ? 'نجوای گروهی' : 'مینی‌اپ'}
                      </span>
                      <span className="font-mono tabular-nums">{w.created_at.slice(0, 16)}</span>
                    </div>

                    <p className="text-sm text-slate-100 leading-relaxed">{w.message}</p>

                    {w.reply_text && (
                      <div className="rounded-xl bg-[#070B1A] border border-slate-800 px-4 py-2.5 text-xs text-slate-300">
                        پاسخ ناشناس تو: {w.reply_text}
                        {w.two_way_accepted ? ' · گفت‌وگوی دوطرفه ناشناس فعال شد' : ''}
                      </div>
                    )}

                    {replyTargetId === w.id ? (
                      <div className="space-y-2.5 pt-1">
                        <input
                          type="text"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="پاسخ ناشناس خود را بنویسید..."
                          className="w-full rounded-xl border border-slate-700 bg-[#070B1A] px-3.5 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={acceptTwoWay}
                              onChange={(e) => setAcceptTwoWay(e.target.checked)}
                              className="accent-cyan-400"
                            />
                            <span>پذیرش گفت‌وگوی دوطرفه ناشناس</span>
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setReplyTargetId(null)}
                              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                            >
                              انصراف
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReply(w.id)}
                              className="rounded-lg bg-cyan-400 px-3.5 py-1.5 text-xs font-semibold text-slate-950"
                            >
                              ثبت پاسخ
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTargetId(w.id);
                            setReplyText(w.reply_text || '');
                          }}
                          className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 min-h-[36px]"
                        >
                          <Reply className="w-3.5 h-3.5" />
                          <span>{w.reply_text ? 'ویرایش پاسخ' : 'پاسخ ناشناس'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleModerateWhisper(w.id, 'block')}
                          className="inline-flex items-center gap-1.5 text-slate-400 hover:text-rose-300 min-h-[36px]"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>مسدودسازی فرستنده</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleModerateWhisper(w.id, 'report')}
                          className="inline-flex items-center gap-1.5 text-slate-400 hover:text-amber-300 min-h-[36px]"
                        >
                          <Flag className="w-3.5 h-3.5" />
                          <span>گزارش آزار</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sent Whispers Status */}
          {sent.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-[#0B1022] p-5 space-y-3">
              <h3 className="text-sm font-bold text-white">نجواهای ارسالی تو ({sent.length})</h3>
              <div className="divide-y divide-slate-800/80">
                {sent.slice(0, 5).map((s) => (
                  <div key={s.id} className="py-2.5 text-xs space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>به: {s.recipient_name} (@{s.recipient_username})</span>
                      <span className="font-mono tabular-nums">{s.created_at.slice(0, 10)}</span>
                    </div>
                    <p className="text-slate-200">{s.message}</p>
                    {s.reply_text && (
                      <p className="text-cyan-300">پاسخ دریافت‌شده: {s.reply_text}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
