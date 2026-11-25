export type ModerationSensitivity = 'low' | 'medium' | 'strict';

export interface GroupModerationRules {
  anti_link: number;
  anti_ads: number;
  anti_spam: number;
  anti_flood: number;
  anti_tabchi?: number;
  lock_media: number;
  banned_words: string;
  sensitivity_level?: ModerationSensitivity;
  mute_duration_minutes?: number;
}

export interface ModerationContext {
  groupId: number;
  senderKey: string;
  hasMedia?: boolean;
  isForwarded?: boolean;
  mentionCount?: number;
}

export interface ModerationDecision {
  allowed: boolean;
  action: 'allow' | 'delete' | 'warn' | 'mute';
  reason: string;
  matchedRule?: string;
  muteMinutes?: number;
}

interface RecentSenderEvent {
  at: number;
  normalizedText: string;
}

declare global {
  var __madarFloodWindow: Map<string, RecentSenderEvent[]> | undefined;
}

const floodWindow = globalThis.__madarFloodWindow ?? new Map<string, RecentSenderEvent[]>();
globalThis.__madarFloodWindow = floodWindow;

// Normalize Persian/Arabic characters & strip zero-width obfuscation used by tabchi bots
function normalizeForScan(input: string): string {
  return input
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const URL_REGEX =
  /(https?:\/\/|t\.me\/|telegram\.me\/|telegram\.dog\/|www\.|wa\.me\/|instagram\.com\/|rubika\.ir\/|eitaa\.com\/|\b[a-z0-9-]+\s*\.\s*(ir|com|net|org|me|io|xyz|tk|ru|co)\b)/i;

const INVITE_HANDLE_REGEX = /@[a-z0-9_]{4,}/gi;

const AD_KEYWORDS = [
  'عضو شوید',
  'عضو شید',
  'کانال ما',
  'فروش فوری',
  'پکیج رایگان',
  'کلیک کن',
  'درآمد میلیونی',
  'درامد میلیونی',
  'سیگنال رایگان',
  'کسب درآمد',
  'ثبت نام رایگان',
  'تخفیف استثنایی',
  'وی پی ان پرسرعت',
  'فیلترشکن پرسرعت',
  'خرید فالوور',
  'سایت شرط بندی',
  'بونوس رایگان',
  'شارژ رایگان',
];

const TABCHI_PATTERNS: RegExp[] = [
  /(جوین|عضویت)\s*(شو|شید|بشید|اجباری)/i,
  /(دایرکت|پی‌وی|پیوی|pv)\s*(بیا|پیام بده|مراجعه)/i,
  /(تضمین سود|سود روزانه|ارز دیجیتال رایگان|ایردراپ تضمینی)/i,
  /(شارژ هدیه|اینترنت رایگان|کد هدیه رایگان)/i,
  /([0-9۰-۹]{11}|09[0-9۰-۹]{9}).*(تماس|واتساپ|تلگرام|فروش)/i,
];

function getFloodThresholds(sensitivity: ModerationSensitivity): { maxMsgs: number; windowMs: number; duplicateLimit: number } {
  if (sensitivity === 'strict') return { maxMsgs: 3, windowMs: 8_000, duplicateLimit: 2 };
  if (sensitivity === 'low') return { maxMsgs: 7, windowMs: 12_000, duplicateLimit: 4 };
  return { maxMsgs: 5, windowMs: 10_000, duplicateLimit: 3 };
}

export function evaluateGroupMessage(
  text: string,
  hasMedia: boolean,
  rules: GroupModerationRules,
  ctx?: Partial<ModerationContext>
): ModerationDecision {
  const raw = text.trim();
  const normalized = normalizeForScan(raw);
  const sensitivity: ModerationSensitivity = rules.sensitivity_level || 'medium';
  const muteMinutes = Math.max(1, Math.min(1440, Number(rules.mute_duration_minutes || 10)));

  // 1. Sliding-window Flood & Repeated-Message Detection
  if (ctx?.groupId && ctx?.senderKey) {
    const key = `${ctx.groupId}:${ctx.senderKey}`;
    const now = Date.now();
    const { maxMsgs, windowMs, duplicateLimit } = getFloodThresholds(sensitivity);
    const prev = (floodWindow.get(key) || []).filter((ev) => now - ev.at <= Math.max(windowMs, 45_000));
    prev.push({ at: now, normalizedText: normalized });
    floodWindow.set(key, prev.slice(-20));

    if (rules.anti_flood) {
      const inWindow = prev.filter((ev) => now - ev.at <= windowMs);
      if (inWindow.length > maxMsgs) {
        return {
          allowed: false,
          action: 'mute',
          muteMinutes,
          reason: `ارسال پی‌درپی بیش از حد مجاز (${inWindow.length} پیام در ${Math.round(windowMs / 1000)} ثانیه).`,
          matchedRule: 'anti_flood',
        };
      }
    }

    if (rules.anti_spam && normalized.length >= 6) {
      const sameRecent = prev.filter((ev) => now - ev.at <= 45_000 && ev.normalizedText === normalized);
      if (sameRecent.length >= duplicateLimit) {
        return {
          allowed: false,
          action: 'mute',
          muteMinutes,
          reason: 'ارسال مکرر پیام تکراری (ضداسپم).',
          matchedRule: 'duplicate_spam',
        };
      }
    }
  }

  // 2. Media lock
  if (rules.lock_media && (hasMedia || ctx?.hasMedia)) {
    return {
      allowed: false,
      action: 'delete',
      reason: 'قفل رسانه در این گروه فعال است.',
      matchedRule: 'lock_media',
    };
  }

  // 3. Anti-Link (including obfuscated domains)
  if (rules.anti_link && URL_REGEX.test(normalized)) {
    return {
      allowed: false,
      action: 'delete',
      reason: 'ارسال لینک یا آدرس دعوت مجاز نیست (ضدلینک).',
      matchedRule: 'anti_link',
    };
  }

  // 4. Anti-Tabchi / Nuisance bot patterns
  const antiTabchiEnabled = rules.anti_tabchi !== undefined ? Boolean(rules.anti_tabchi) : Boolean(rules.anti_ads);
  if (antiTabchiEnabled) {
    const handles = raw.match(INVITE_HANDLE_REGEX) || [];
    const massMentions = (ctx?.mentionCount || 0) >= 4 || handles.length >= (sensitivity === 'strict' ? 2 : 3);
    const hasTabchiPhrase = TABCHI_PATTERNS.some((rx) => rx.test(normalized));
    const forwardedAd = Boolean(ctx?.isForwarded) && (URL_REGEX.test(normalized) || handles.length > 0);
    if (massMentions || hasTabchiPhrase || forwardedAd) {
      return {
        allowed: false,
        action: 'mute',
        muteMinutes,
        reason: 'الگوی تبچی یا مزاحمت تبلیغاتی شناسایی شد.',
        matchedRule: 'anti_tabchi',
      };
    }
  }

  // 5. Anti-Ads
  if (rules.anti_ads && AD_KEYWORDS.some((kw) => normalized.includes(normalizeForScan(kw)))) {
    return {
      allowed: false,
      action: sensitivity === 'strict' ? 'delete' : 'warn',
      reason: 'محتوای تبلیغاتی شناسایی شد (ضدتبلیغات).',
      matchedRule: 'anti_ads',
    };
  }

  // 6. Custom banned words
  const bannedList = (rules.banned_words || '')
    .split(/[،,\n]+/)
    .map((w) => normalizeForScan(w))
    .filter(Boolean);
  for (const word of bannedList) {
    if (word && normalized.includes(word)) {
      return {
        allowed: false,
        action: 'delete',
        reason: `پیام شامل واژه فیلترشده («${word}») است.`,
        matchedRule: 'word_filter',
      };
    }
  }

  // 7. Character flood / repetitive spam
  if (rules.anti_spam) {
    const charRepeatLimit = sensitivity === 'strict' ? 7 : 10;
    const repeatRx = new RegExp(`(.)\\1{${charRepeatLimit},}`);
    if (normalized.length > 12 && repeatRx.test(normalized)) {
      return {
        allowed: false,
        action: 'delete',
        reason: 'ارسال کاراکترهای تکراری و اسپم (ضداسپم).',
        matchedRule: 'anti_spam',
      };
    }
  }

  return { allowed: true, action: 'allow', reason: 'پیام مطابق قوانین گروه است.' };
}

export interface LocalGroupReplyInput {
  groupTitle: string;
  rulesText: string;
  welcomeText: string;
  userMessage: string;
  senderName: string;
  activeProtections: string[];
}

export function generateLocalGroupReply(input: LocalGroupReplyInput): { text: string; engine: string } {
  const q = normalizeForScan(input.userMessage);
  const name = input.senderName.trim() || 'دوست عزیز';

  if (q.includes('قانون') || q.includes('قوانین') || q === '/rules') {
    return {
      engine: 'madar-local-rules',
      text: `قوانین گروه ${input.groupTitle}:\n${input.rulesText || 'احترام متقابل و پرهیز از اسپم و تبلیغات.'}`,
    };
  }

  if (q.includes('بازی') || q.includes('حکم') || q.includes('مافیا') || q.includes('جرئت') || q.includes('کوییز')) {
    return {
      engine: 'madar-local-rules',
      text: `${name}، برای شروع بازی گروهی از دستور /mafia در گروه استفاده کن یا مینی‌اپ مدار را باز کن تا اتاق دورهمی (حکم، مافیا، جرئت و حقیقت، کوییز) ساخته شود.`,
    };
  }

  if (q.includes('حفاظت') || q.includes('وضعیت') || q.includes('اسپم') || q.includes('لینک') || q.includes('تبچی')) {
    const list = input.activeProtections.length > 0 ? input.activeProtections.join('، ') : 'همه فیلترها خاموش';
    return {
      engine: 'madar-local-rules',
      text: `سپر محلی گروه ${input.groupTitle} فعال است.\nقوانین فعال: ${list}`,
    };
  }

  if (q.includes('سلام') || q.includes('خوش') || q.includes('درود')) {
    return {
      engine: 'madar-local-rules',
      text: `سلام ${name}! ${input.welcomeText || `به گروه ${input.groupTitle} خوش آمدی.`}`,
    };
  }

  if (q.includes('راهنما') || q.includes('دستور') || q === '/help') {
    return {
      engine: 'madar-local-rules',
      text: `دستورات محلی گروه:\n• /rules — نمایش قوانین گروه\n• /mafia — شروع مافیا و رأی‌گیری گروهی\n• /status — نمایش سپرهای فعال ضداسپم و ضدتبچی\nتمام کنترل‌ها بدون وابستگی به API خارجی و کاملاً محلی اجرا می‌شوند.`,
    };
  }

  return {
    engine: 'madar-local-rules',
    text: `${name}، پیام تو دریافت شد. برای دیدن قوانین بنویس «قوانین»، برای وضعیت سپر ضداسپم بنویس «وضعیت» و برای شروع دورهمی بنویس «بازی».`,
  };
}
