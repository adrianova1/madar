'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Ban,
  Eye,
  EyeOff,
  Flag,
  HelpCircle,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { triggerHaptic, triggerHapticNotice } from '@/lib/telegram-webapp';
import { madarSound } from './SoundFX';

interface BlindDateSession {
  id: number;
  sessionCode: string;
  status: string;
  myAlias: string;
  partnerAlias: string;
  compatibilityScore: number;
  sharedTraits: string[];
  qaState: {
    questionId: string;
    question: string;
    myAnswer?: string;
    partnerAnswer?: string;
  }[];
  userMessageCount: number;
  revealEligible: boolean;
  myRevealConsent: boolean;
  partnerRevealConsent: boolean;
  mutuallyRevealed: boolean;
  partnerCard: {
    revealed: boolean;
    displayName: string;
    username: string;
    age: number | null;
    city: string;
    bio: string;
    goal: string;
    interests: string[];
    avatarInitials: string;
    avatarColor: string;
    phoneVerified: boolean;
  };
  messages: {
    id: number;
    mine: boolean;
    msgType: string;
    content: string;
    createdAt: string;
  }[];
}

interface QaBankItem {
  id: string;
  question: string;
  options: string[];
}

interface BlindDateArenaProps {
  token: string;
  onSessionMatched?: () => Promise<void>;
}

const REACTIONS = ['✨', '😊', '😂', '👏', '💫'];

export default function BlindDateArena({ token, onSessionMatched }: BlindDateArenaProps) {
  const [sessions, setSessions] = useState<BlindDateSession[]>([]);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [icebreakers, setIcebreakers] = useState<string[]>([]);
  const [qaBank, setQaBank] = useState<QaBankItem[]>([]);
  const [showQaDrawer, setShowQaDrawer] = useState(false);
  const [chatText, setChatText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const res = await fetch('/api/venus/blind-date', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    const list: BlindDateSession[] = data.sessions || [];
    setSessions(list);
    setIcebreakers(data.icebreakers || []);
    setQaBank(data.qaBank || []);
    setActiveCode((prev) => {
      if (prev && list.some((s) => s.sessionCode === prev)) return prev;
      return list[0]?.sessionCode ?? null;
    });
  }, [token]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (mounted) await loadSessions();
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [loadSessions]);

  const activeSession = sessions.find((s) => s.sessionCode === activeCode) || null;

  async function callBlindApi(payload: Record<string, unknown>) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/venus/blind-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error || 'عملیات انجام نشد.');
        return null;
      }
      if (data.message) setNotice(data.message);
      if (data.session) {
        const s: BlindDateSession = data.session;
        setSessions((prev) => {
          const exists = prev.some((item) => item.sessionCode === s.sessionCode);
          return exists ? prev.map((item) => (item.sessionCode === s.sessionCode ? s : item)) : [s, ...prev];
        });
        setActiveCode(s.sessionCode);
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function handleStartNew() {
    triggerHaptic('medium');
    madarSound.playClick();
    await callBlindApi({ action: 'start' });
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSession || !chatText.trim()) return;
    const content = chatText.trim();
    setChatText('');
    await callBlindApi({
      action: 'send_message',
      sessionCode: activeSession.sessionCode,
      content,
      msgType: 'text',
    });
  }

  async function handleSendQuick(content: string, msgType: 'text' | 'reaction' = 'text') {
    if (!activeSession) return;
    triggerHaptic('light');
    await callBlindApi({
      action: 'send_message',
      sessionCode: activeSession.sessionCode,
      content,
      msgType,
    });
  }

  async function handleAnswerQa(questionId: string, answer: string) {
    if (!activeSession) return;
    triggerHaptic('medium');
    madarSound.playCorrect();
    await callBlindApi({
      action: 'play_qa',
      sessionCode: activeSession.sessionCode,
      questionId,
      answer,
    });
  }

  async function handleRequestReveal() {
    if (!activeSession) return;
    triggerHaptic('medium');
    const data = await callBlindApi({
      action: 'request_reveal',
      sessionCode: activeSession.sessionCode,
    });
    if (data?.revealed) {
      madarSound.playWinFanfare();
      triggerHapticNotice('success');
      if (onSessionMatched) await onSessionMatched();
    }
  }

  async function handleEndOrSafety(kind: 'end' | 'block' | 'report') {
    if (!activeSession) return;
    if (kind === 'end') {
      await callBlindApi({ action: 'end_session', sessionCode: activeSession.sessionCode });
    } else {
      await callBlindApi({ action: 'report_or_block', sessionCode: activeSession.sessionCode, kind });
    }
    await loadSessions();
  }

  return (
    <div className="space-y-5 min-w-0">
      {/* Intro & Session Launcher */}
      <div className="madar-glass rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <p className="text-xs text-purple-300 flex items-center gap-1.5">
            <EyeOff className="w-3.5 h-3.5" />
            <span>آشنایی ناشناس واقعی (Blind Date) · هویت مخفی تا رضایت دوطرفه</span>
          </p>
          <h2 className="text-base sm:text-lg font-bold text-white">
            اول گفت‌وگو و هم‌فکری، سپس نمایش هویت با تایید هر دو نفر
          </h2>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={handleStartNew}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-purple-500 to-rose-500 px-5 py-2.5 text-xs sm:text-sm font-bold text-white hover:brightness-110 disabled:opacity-60 whitespace-nowrap shrink-0 min-h-[44px]"
        >
          <UserPlus className="w-4 h-4" />
          <span>شروع آشنایی ناشناس جدید</span>
        </button>
      </div>

      {notice && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs sm:text-sm text-amber-100">
          {notice}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="madar-glass rounded-3xl p-8 text-center space-y-4">
          <Sparkles className="w-10 h-10 text-purple-400 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">آماده برای اولین آشنایی ناشناس هستی؟</h3>
            <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              یک نام مستعار کیهانی می‌گیری، با کارت علایق و ویژگی‌های مشترک آشنا می‌شوی و پس از حداقل ۲ پیام یا ۱ دور مینی‌بازی پرسش‌وپاسخ، با رضایت دوطرفه هویت واقعی آشکار می‌شود.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleStartNew}
            className="rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 min-h-[46px]"
          >
            شروع گفت‌وگوی ناشناس
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Active Sessions List (Left/Right rail) */}
          <aside className="lg:col-span-4 space-y-3">
            <div className="madar-glass rounded-2xl p-3.5 space-y-2">
              <p className="text-xs font-bold text-slate-300 px-1">جلسات ناشناس فعال ({sessions.length})</p>
              <div className="space-y-1.5">
                {sessions.map((s) => {
                  const isActive = s.sessionCode === activeSession?.sessionCode;
                  return (
                    <button
                      key={s.sessionCode}
                      type="button"
                      onClick={() => setActiveCode(s.sessionCode)}
                      className={`w-full rounded-xl p-3 text-right border transition-colors min-h-[58px] flex items-center justify-between gap-2.5 ${
                        isActive
                          ? 'border-purple-400/60 bg-purple-500/15'
                          : 'border-indigo-500/15 bg-[#050816] hover:border-indigo-400/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0 border border-white/15"
                          style={{ backgroundColor: s.partnerCard.avatarColor }}
                        >
                          {s.partnerCard.avatarInitials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-white truncate">
                            {s.partnerCard.displayName}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {s.mutuallyRevealed ? 'هویت آشکار شد' : 'ناشناس'} · سازگاری تخمینی{' '}
                            <span className="font-mono text-amber-300">{s.compatibilityScore}%</span>
                          </p>
                        </div>
                      </div>
                      <MessageCircle className="w-4 h-4 text-purple-300 shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Partner Mystery / Revealed Personality Card */}
            {activeSession && (
              <motion.div
                key={activeSession.sessionCode + String(activeSession.mutuallyRevealed)}
                initial={{ opacity: 0.7, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`rounded-2xl border p-4 space-y-3.5 ${
                  activeSession.mutuallyRevealed
                    ? 'border-emerald-400/50 bg-gradient-to-b from-emerald-950/35 to-[#070b1e]'
                    : 'border-purple-400/35 bg-[#070b1e]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold text-white shrink-0 border border-white/15"
                    style={{ backgroundColor: activeSession.partnerCard.avatarColor }}
                  >
                    {activeSession.partnerCard.avatarInitials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">
                      {activeSession.partnerCard.displayName}
                      {activeSession.partnerCard.age ? `، ${activeSession.partnerCard.age}` : ''}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {activeSession.partnerCard.city} · سازگاری تخمینی{' '}
                      <strong className="font-mono text-amber-300">{activeSession.compatibilityScore}%</strong>
                    </p>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{activeSession.partnerCard.bio}</p>

                {activeSession.sharedTraits.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-white/10">
                    <p className="text-[11px] text-cyan-300 font-semibold">نقاط مشترک شناخته‌شده:</p>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {activeSession.sharedTraits.join(' · ')}
                    </p>
                  </div>
                )}

                {activeSession.partnerCard.interests.length > 0 && (
                  <p className="text-[11px] text-slate-400">
                    علایق: {activeSession.partnerCard.interests.join(' · ')}
                  </p>
                )}

                {/* Mutual Identity Reveal Control */}
                <div className="pt-2 border-t border-white/10 space-y-2">
                  {activeSession.mutuallyRevealed ? (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>هویت با رضایت دوطرفه آشکار و مچینگ ثبت شد!</span>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy || !activeSession.revealEligible || activeSession.myRevealConsent}
                        onClick={handleRequestReveal}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 py-2.5 px-3 text-xs font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50 min-h-[44px]"
                      >
                        <Eye className="w-4 h-4 shrink-0" />
                        <span>
                          {activeSession.myRevealConsent
                            ? 'منتظر تایید طرف مقابل...'
                            : 'درخواست افشای هویت (دوطرفه)'}
                        </span>
                      </button>
                      {!activeSession.revealEligible && (
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          برای فعال‌شدن افشای هویت: حداقل ۲ پیام ارسال کن ({activeSession.userMessageCount}/2) یا ۱ سؤال از مینی‌بازی پرسش‌وپاسخ را جواب بده.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </aside>

          {/* Anonymous Chat & 2-Player Q&A Mini-Game Stage */}
          {activeSession && (
            <div className="lg:col-span-8 madar-glass rounded-3xl flex flex-col min-h-[470px] overflow-hidden">
              {/* Chat Header with Safety & Q&A Toggle */}
              <div className="px-4 py-3.5 border-b border-indigo-500/20 flex flex-wrap items-center justify-between gap-2 bg-[#050816]/80">
                <div className="min-w-0">
                  <p className="text-xs text-slate-400">
                    نام مستعار تو: <strong className="text-cyan-300">{activeSession.myAlias}</strong>
                  </p>
                  <p className="text-sm font-bold text-white truncate">
                    گفت‌وگو با {activeSession.partnerCard.displayName}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowQaDrawer((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold min-h-[36px] ${
                      showQaDrawer
                        ? 'border-cyan-400 bg-cyan-400 text-slate-950'
                        : 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200'
                    }`}
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>مینی‌بازی پرسش‌وپاسخ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleEndOrSafety('end')}
                    title="پایان چت"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:text-amber-300 min-h-[36px]"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">پایان چت</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEndOrSafety('block')}
                    title="بلاک"
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-300 min-h-[36px]"
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEndOrSafety('report')}
                    title="گزارش"
                    className="p-2 rounded-lg text-slate-400 hover:text-amber-300 min-h-[36px]"
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Collapsible 2-Player Q&A Mini-Game Drawer */}
              {showQaDrawer && (
                <div className="p-4 border-b border-cyan-500/25 bg-[#070f28] space-y-3">
                  <p className="text-xs font-bold text-cyan-300">
                    مینی‌بازی پرسش‌وپاسخ دونفره — یک سؤال را جواب بده تا هم‌صحبتت هم پاسخ دهد:
                  </p>
                  <div className="space-y-3 max-h-56 overflow-y-auto madar-scroll-y pl-1">
                    {qaBank.map((q) => {
                      const answered = activeSession.qaState.find((item) => item.questionId === q.id);
                      return (
                        <div key={q.id} className="rounded-xl border border-indigo-500/25 bg-[#050816] p-3 space-y-2">
                          <p className="text-xs font-semibold text-white">{q.question}</p>
                          {answered ? (
                            <div className="text-[11px] space-y-1">
                              <p className="text-amber-300">پاسخ تو: {answered.myAnswer}</p>
                              <p className="text-purple-200">پاسخ هم‌صحبت: {answered.partnerAnswer}</p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {q.options.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleAnswerQa(q.id, opt)}
                                  className="rounded-lg border border-indigo-500/25 bg-[#0a1026] hover:border-cyan-400 px-2.5 py-2 text-right text-[11px] text-slate-200 min-h-[36px]"
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Messages Stream */}
              <div className="flex-1 p-4 space-y-3 overflow-y-auto madar-scroll-y max-h-[310px]">
                {activeSession.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${
                      m.msgType === 'system'
                        ? 'justify-center'
                        : m.mine
                          ? 'justify-start'
                          : 'justify-end'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed ${
                        m.msgType === 'system'
                          ? 'bg-indigo-950/70 border border-indigo-500/30 text-cyan-200 text-center text-xs'
                          : m.msgType === 'qa_answer'
                            ? 'bg-purple-500/20 border border-purple-400/40 text-purple-100'
                            : m.mine
                              ? 'bg-amber-400 text-slate-950 font-medium'
                              : 'bg-slate-800/90 text-slate-100'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick Icebreakers & Reactions Rail */}
              <div className="px-3.5 py-2 border-t border-indigo-500/15 bg-[#050816]/60 space-y-2">
                <div className="madar-scroll-x">
                  <div className="inline-flex items-center gap-1.5">
                    {REACTIONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        disabled={busy}
                        onClick={() => handleSendQuick(r, 'reaction')}
                        className="w-8 h-8 rounded-lg border border-indigo-500/25 bg-[#0a1026] hover:border-amber-400 text-sm shrink-0"
                      >
                        {r}
                      </button>
                    ))}
                    {icebreakers.map((ice, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={busy}
                        onClick={() => handleSendQuick(ice, 'text')}
                        className="rounded-lg border border-purple-400/30 bg-purple-500/10 px-2.5 py-1.5 text-[11px] text-purple-200 hover:bg-purple-500/25 whitespace-nowrap shrink-0"
                      >
                        یخ‌شکن {idx + 1}: {ice.slice(0, 28)}...
                      </button>
                    ))}
                  </div>
                </div>

                {/* Chat Input Bar */}
                <form onSubmit={handleSendMessage} className="flex gap-2 pb-1">
                  <input
                    type="text"
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder="پیام محترمانه ناشناس خود را بنویسید..."
                    className="flex-1 min-w-0 rounded-xl border border-indigo-500/30 bg-[#0a1026] px-3.5 py-2.5 text-base sm:text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy || !chatText.trim()}
                    className="inline-flex items-center justify-center gap-1 rounded-xl bg-amber-400 px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50 min-h-[44px] shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    <span>ارسال</span>
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
