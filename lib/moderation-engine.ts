export interface GroupModerationRules {
  anti_link: number;
  anti_ads: number;
  anti_spam: number;
  anti_flood: number;
  lock_media: number;
  banned_words: string;
}

export interface ModerationDecision {
  allowed: boolean;
  action: 'allow' | 'delete' | 'warn' | 'mute';
  reason: string;
  matchedRule?: string;
}

const URL_REGEX = /(https?:\/\/|t\.me\/|telegram\.me\/|www\.|\.[a-z]{2,}\/)/i;
const AD_KEYWORDS = ['عضو شوید', 'کانال ما', 'فروش فوری', 'پکیج رایگان', 'کلیک کن', 'درامد میلیونی'];

export function evaluateGroupMessage(
  text: string,
  hasMedia: boolean,
  rules: GroupModerationRules
): ModerationDecision {
  const trimmed = text.trim();

  if (rules.lock_media && hasMedia) {
    return {
      allowed: false,
      action: 'delete',
      reason: 'قفل رسانه در این گروه فعال است.',
      matchedRule: 'lock_media',
    };
  }

  if (rules.anti_link && URL_REGEX.test(trimmed)) {
    return {
      allowed: false,
      action: 'delete',
      reason: 'ارسال لینک یا آدرس دعوت در گروه مجاز نیست (ضدلینک).',
      matchedRule: 'anti_link',
    };
  }

  if (rules.anti_ads && AD_KEYWORDS.some((kw) => trimmed.includes(kw))) {
    return {
      allowed: false,
      action: 'warn',
      reason: 'محتوای تبلیغاتی شناسایی شد (ضدتبلیغات).',
      matchedRule: 'anti_ads',
    };
  }

  const bannedList = rules.banned_words
    .split(/[،,\n]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  for (const word of bannedList) {
    if (trimmed.includes(word)) {
      return {
        allowed: false,
        action: 'delete',
        reason: `پیام شامل واژه فیلترشده («${word}») است.`,
        matchedRule: 'word_filter',
      };
    }
  }

  if (rules.anti_spam && trimmed.length > 15 && /(.)\1{9,}/.test(trimmed)) {
    return {
      allowed: false,
      action: 'mute',
      reason: 'ارسال کاراکترهای تکراری و اسپم شناسایی شد (ضداسپم).',
      matchedRule: 'anti_spam',
    };
  }

  return { allowed: true, action: 'allow', reason: 'پیام عادی و مطابق قوانین گروه است.' };
}
