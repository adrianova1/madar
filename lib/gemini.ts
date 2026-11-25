import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface GroupAssistantOptions {
  groupTitle: string;
  humorLevel: string;
  maxChars: number;
  allowedTopics: string;
  userMessage: string;
  senderName: string;
}

export async function askMadarGroupAssistant(opts: GroupAssistantOptions): Promise<{
  text: string;
  model: string;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
  }

  const model = 'gemini-4-hydrogen';
  const systemInstruction = [
    'تو دستیار هوشمند رسمی پلتفرم «مدار» (MADAR) در گروه تلگرامی هستی.',
    `نام گروه: ${opts.groupTitle}.`,
    `سطح شوخ‌طبعی تنظیم‌شده توسط مدیر گروه: ${opts.humorLevel}.`,
    `موضوعات مجاز: ${opts.allowedTopics}.`,
    `پاسخ را به زبان فارسی روان، محترمانه و حداکثر در حدود ${opts.maxChars} کاراکتر بنویس.`,
    'از افشای اطلاعات خصوصی اعضا خودداری کن و اگر کاربر بازی خواست، بازی‌های حکم، مافیا، کوییز یا جرئت و حقیقت مدار را پیشنهاد بده.',
    'هرگز از مارک‌داون شلوغ استفاده نکن؛ پاسخ طبیعی و مناسب پیام تلگرام باشد.',
  ].join('\n');

  const response = await ai.models.generateContent({
    model,
    contents: `پیام عضو گروه (${opts.senderName}): ${opts.userMessage}`,
    config: {
      systemInstruction,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
      },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('EMPTY_GEMINI_RESPONSE');
  }

  return { text, model };
}
