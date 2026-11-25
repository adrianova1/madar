export interface PersonalityQuestionDef {
  id: string;
  dimensionKey: string;
  dimensionTitle: string;
  questionType: 'choice' | 'scale' | 'situational';
  prompt: string;
  options: { value: number; label: string }[];
}

export const PERSONALITY_QUESTIONS: PersonalityQuestionDef[] = [
  {
    id: 'q1',
    dimensionKey: 'communication',
    dimensionTitle: 'سبک ارتباطی',
    questionType: 'choice',
    prompt: 'در یک گفت‌وگوی مهم، کدام شیوه بیان بیشتر شبیه توست؟',
    options: [
      { value: 2, label: 'کوتاه، دقیق و سنجیده' },
      { value: 4, label: 'گفت‌وگوی مستقیم و آرام' },
      { value: 5, label: 'صمیمی، گرم و پرجزئیات' },
    ],
  },
  {
    id: 'q2',
    dimensionKey: 'extroversion',
    dimensionTitle: 'درون‌گرایی و برون‌گرایی',
    questionType: 'scale',
    prompt: 'پس از یک هفته شلوغ، انرژی خودت را چگونه بازیابی می‌کنی؟',
    options: [
      { value: 1, label: 'تنهایی آرام در خانه یا مطالعه' },
      { value: 3, label: 'میان‌گرا (بسته به حال‌وهوا و جمع)' },
      { value: 5, label: 'دورهمی پرانرژی با دوستان و بازی گروهی' },
    ],
  },
  {
    id: 'q3',
    dimensionKey: 'affection',
    dimensionTitle: 'سبک ابراز علاقه',
    questionType: 'choice',
    prompt: 'کدام رفتار بیشتر حس ارزشمند بودن و توجه را به تو منتقل می‌کند؟',
    options: [
      { value: 3, label: 'حمایت عملی و همراهی در کارها' },
      { value: 4, label: 'کلمات محبت‌آمیز و تشویق صریح' },
      { value: 5, label: 'توجه به جزئیات و زمان باکیفیت دونفره' },
    ],
  },
  {
    id: 'q4',
    dimensionKey: 'conflict',
    dimensionTitle: 'شیوه حل اختلاف',
    questionType: 'situational',
    prompt: 'وقتی با کسی سوءتفاهم پیش می‌آید، اولین واکنش معمول تو چیست؟',
    options: [
      { value: 2, label: 'کمی فاصله می‌گیرم تا فضا آرام شود' },
      { value: 4, label: 'گفت‌وگوی منطقی پس از کمی مکث' },
      { value: 5, label: 'همان لحظه با همدلی درباره آن حرف می‌زنم' },
    ],
  },
  {
    id: 'q5',
    dimensionKey: 'adventure',
    dimensionTitle: 'میزان ماجراجویی',
    questionType: 'scale',
    prompt: 'نسبت به سفرهای برنامه‌ریزی‌نشده و تجربه‌های تازه چه حسی داری؟',
    options: [
      { value: 2, label: 'برنامه‌ریزی دقیق و پیش‌بینی‌پذیری را ترجیح می‌دهم' },
      { value: 3, label: 'متعادل بین امنیت و هیجان' },
      { value: 5, label: 'ماجراجو و مشتاق کشف مسیرهای تازه' },
    ],
  },
  {
    id: 'q6',
    dimensionKey: 'independence',
    dimensionTitle: 'استقلال و صمیمیت',
    questionType: 'scale',
    prompt: 'در یک رابطه نزدیک، مرز میان فضای شخصی و همراهی چطور باید باشد؟',
    options: [
      { value: 2, label: 'نیازمند فضای شخصی مستقل و مشخص' },
      { value: 3, label: 'تعادل میان استقلال و صمیمیت' },
      { value: 5, label: 'همراهی نزدیک و اشتراک اکثر برنامه‌ها' },
    ],
  },
  {
    id: 'q7',
    dimensionKey: 'social_interests',
    dimensionTitle: 'علایق اجتماعی',
    questionType: 'choice',
    prompt: 'در یک جمع جدید معمولاً چه نقشی می‌گیری؟',
    options: [
      { value: 2, label: 'شنونده دقیق و تحلیل‌گر جمع' },
      { value: 4, label: 'همراه گفت‌وگوهای دونفره عمیق' },
      { value: 5, label: 'شروع‌کننده بحث و هدایت‌گر بازی‌ها' },
    ],
  },
  {
    id: 'q8',
    dimensionKey: 'relationship_pref',
    dimensionTitle: 'ترجیحات رابطه',
    questionType: 'choice',
    prompt: 'مهم‌ترین ستون یک آشنایی پایدار از نظر تو چیست؟',
    options: [
      { value: 3, label: 'صداقت و شفافیت در هدف' },
      { value: 4, label: 'شوخ‌طبعی و درک متقابل روزمره' },
      { value: 5, label: 'ارزش‌های مشترک و رشد کنار هم' },
    ],
  },
  {
    id: 'q9',
    dimensionKey: 'leisure',
    dimensionTitle: 'علایق تفریحی',
    questionType: 'choice',
    prompt: 'ایده‌آل‌ترین جمعه برای تو کدام است؟',
    options: [
      { value: 2, label: 'فیلم، کتاب و قهوه در آرامش' },
      { value: 4, label: 'کافه‌گردی، گالری و پیاده‌روی عصرانه' },
      { value: 5, label: 'طبیعت‌گردی، ورزش یا شب بازی گروهی' },
    ],
  },
  {
    id: 'q10',
    dimensionKey: 'values',
    dimensionTitle: 'ارزش‌ها و اولویت‌های زندگی',
    questionType: 'choice',
    prompt: 'در انتخاب‌های بزرگ زندگی، کدام معیار وزن بیشتری برایت دارد؟',
    options: [
      { value: 3, label: 'ثبات، امنیت و آرامش ذهنی' },
      { value: 4, label: 'یادگیری، رشد فردی و خلاقیت' },
      { value: 5, label: 'آزادی، تجربه و ساخت خاطره' },
    ],
  },
  {
    id: 'q11',
    dimensionKey: 'decision_making',
    dimensionTitle: 'سبک تصمیم‌گیری',
    questionType: 'situational',
    prompt: 'برای یک انتخاب مهم میان دو مسیر متفاوت چگونه تصمیم می‌گیری؟',
    options: [
      { value: 2, label: 'فهرست مزایا و معایب با تحلیل دقیق' },
      { value: 4, label: 'ترکیب منطق با شهود شخصی' },
      { value: 5, label: 'پیروی از حس درونی و مشورت با افراد مورداعتماد' },
    ],
  },
  {
    id: 'q12',
    dimensionKey: 'interaction_style',
    dimensionTitle: 'سبک تعامل در رابطه',
    questionType: 'choice',
    prompt: 'سرعت آشنایی و صمیمی شدن با افراد جدید برایت چگونه است؟',
    options: [
      { value: 2, label: 'آرام، مرحله‌به‌مرحله و با شناخت عمیق' },
      { value: 4, label: 'طبیعی و متناسب با بازخورد طرف مقابل' },
      { value: 5, label: 'سریع، صمیمی و بی‌تکلف' },
    ],
  },
];

export function computeCompatibility(
  myProfile: { city: string; interests: string[]; goal: string },
  myAnswers: Record<string, number>,
  otherProfile: { city: string; interests: string[]; goal: string },
  otherAnswers: Record<string, number>
): { score: number; sharedInterests: string[]; reasons: string[] } {
  const sharedInterests = myProfile.interests.filter((i) => otherProfile.interests.includes(i));
  const reasons: string[] = [];

  let score = 52;
  if (sharedInterests.length > 0) {
    score += Math.min(20, sharedInterests.length * 7);
    reasons.push(`${sharedInterests.length} علاقه مشترک (${sharedInterests.slice(0, 2).join('، ')})`);
  }
  if (myProfile.city && otherProfile.city && myProfile.city === otherProfile.city) {
    score += 8;
    reasons.push(`هم‌شهر در ${myProfile.city}`);
  }
  if (myProfile.goal && otherProfile.goal && myProfile.goal === otherProfile.goal) {
    score += 10;
    reasons.push('هدف آشنایی هم‌راستا');
  }

  const commonKeys = Object.keys(myAnswers).filter((k) => k in otherAnswers);
  if (commonKeys.length > 0) {
    let diffSum = 0;
    for (const k of commonKeys) {
      diffSum += Math.abs(myAnswers[k] - otherAnswers[k]);
    }
    const avgDiff = diffSum / commonKeys.length;
    const personalityBonus = Math.round(Math.max(0, 16 - avgDiff * 4));
    score += personalityBonus;
    if (personalityBonus >= 10) {
      reasons.push('هماهنگی بالا در سبک ارتباطی');
    }
  }

  if (reasons.length === 0) {
    reasons.push('پروفایل تازه و فعال در مدار');
  }

  return {
    score: Math.max(45, Math.min(98, score)),
    sharedInterests,
    reasons,
  };
}
