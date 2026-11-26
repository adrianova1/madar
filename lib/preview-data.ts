import type {
  MadarUser,
  MissionItem,
  NotificationItem,
  PlanetConfig,
  UserSessionItem,
} from '@/components/madar/types';

/**
 * Strictly isolated in-memory sample dataset for Development Preview (/preview).
 * NEVER touches SQLite, NEVER creates a real user, NEVER logs into @parham_sky,
 * and is completely unreachable in Production.
 */
export const PREVIEW_USER: MadarUser = {
  id: -1,
  telegram_id: null,
  username: 'preview_explorer',
  display_name: 'کاربر پیش‌نمایش',
  telegram_first_name: 'کاربر',
  telegram_last_name: 'پیش‌نمایش',
  telegram_username: 'preview_explorer',
  telegram_photo_url: null,
  telegram_language_code: 'fa',
  last_login_at: '2026-11-25 14:00:00',
  phoneMasked: null,
  phone_verified: 1,
  onboarding_completed: 1,
  role: 'preview',
  subscription_tier: 'plus',
  level: 4,
  xp: 520,
  referral_code: 'preview_only',
  anon_slug: 'preview_explorer',
  allow_whispers: 1,
  avatar_color: '#1d4ed8',
  avatar_initials: 'پش',
  gender: 'unspecified',
  birth_date: '1997-05-12',
  age: 29,
  isAdult: true,
  isAdultVerified: false,
  adultVerification: {
    status: 'unverified',
    phoneVerified: true,
    birthDateOver18: true,
    consentAccepted: false,
    isAdultContentAllowed: false,
    reviewedBy: null,
    reviewedAt: null,
  },
  datingProfile: {
    exists: true,
    isActive: true,
    datingBio: 'این یک پروفایل نمونه فقط برای بررسی طراحی رابط کاربری در محیط توسعه است.',
    lookingFor: 'گفت‌وگوی صمیمی و آشنایی',
    minAge: 20,
    maxAge: 36,
    genderPref: 'all',
    showCity: true,
    activatedAt: '2026-11-01T00:00:00Z',
  },
  constellationFriends: [
    {
      id: -101,
      username: 'sample_sara',
      display_name: 'سارا (نمونه)',
      level: 3,
      avatar_initials: 'سا',
      avatar_color: '#7c3aed',
      created_at: '2026-11-10',
    },
    {
      id: -102,
      username: 'sample_kian',
      display_name: 'کیان (نمونه)',
      level: 5,
      avatar_initials: 'کی',
      avatar_color: '#0284c7',
      created_at: '2026-11-14',
    },
  ],
  earnedBadges: [
    { id: 'pioneer', title: 'کاوشگر مدار', tone: 'sky' },
    { id: 'star_keeper', title: 'ستاره‌چین', tone: 'amber' },
    { id: 'strategist', title: 'استراتژیست بازی‌ها', tone: 'violet' },
  ],
  planetEvolution: {
    stage: 2,
    title: 'زمینِ درخشان',
    subtitle: 'شفق آبی و اولین حلقه مداری فعال',
    ringAccent: '#38bdf8',
    auraStyle: 'aurora',
    evolutionScore: 520,
    nextStageTitle: 'زمینِ اسطرلابی',
    pointsToNext: 180,
    progressPercent: 55,
  },
  city: 'تهران',
  province: 'تهران',
  cultural_bg: '',
  bio: 'حساب آزمایشی کاملاً ایزوله برای تست رابط کاربری بدون دیتابیس واقعی.',
  interests: ['مافیا', 'حکم', 'سینما', 'موسیقی'],
  relationship_status: 'مجرد',
  goal: 'دوستی و بازی گروهی',
  preferred_connection: 'گفت‌وگوی صمیمی',
  favorite_planet: 'earth',
  equipped_frame: 'frame_neptune_halo',
  equipped_badge: 'none',
  hide_city: 0,
  hide_online: 0,
  dating_enabled: 1,
  use_personality_in_matching: 1,
  free_stars: 240,
  paid_stars: 40,
  totalStars: 280,
  referralCount: 2,
  gamesPlayedCount: 6,
};

export const PREVIEW_PLANETS: PlanetConfig[] = [
  { id: 'games', name: 'مریخ و عطارد', subtitle: 'حکم، مافیا، کوییز و جرئت و حقیقت', target: 'games', color: '#8b5cf6', image: '/images/madar/jupiter.jpg' },
  { id: 'venus', name: 'ونوس', subtitle: 'آشنایی هوشمند و Blind Date', target: 'venus', color: '#ec4899', image: '/images/madar/venus.jpg' },
  { id: 'whisper', name: 'نپتون', subtitle: 'نجوای ناشناس و پیام مخفی', target: 'whisper', color: '#38bdf8', image: '/images/madar/neptune.jpg' },
  { id: 'saturn', name: 'زحل', subtitle: 'مدیریت بومی گروه تلگرام', target: 'saturn', color: '#f59e0b', image: '/images/madar/earth.jpg' },
];

export const PREVIEW_MISSIONS: MissionItem[] = [
  { id: 'prev_1', title: 'تکمیل پروفایل اجتماعی', description: 'در حالت پیش‌نمایش فقط برای نمایش UI', reward_stars: 30, action_target: 'profile', claimed: false },
  { id: 'prev_2', title: 'یک دست بازی گروهی', description: 'آزمون نمایش مأموریت‌ها در هاب', reward_stars: 25, action_target: 'games', claimed: true },
];

export const PREVIEW_NOTIFICATIONS: NotificationItem[] = [
  { id: -1, type: 'info', title: 'حالت پیش‌نمایش توسعه فعال است', body: 'تمام داده‌های این صفحه نمونه هستند و هیچ تغییری در دیتابیس واقعی ذخیره نمی‌شود.', is_read: 0, created_at: '2026-11-25 14:00:00' },
];

export const PREVIEW_SESSIONS: UserSessionItem[] = [
  { id: 'preview-session', device_label: 'مرورگر توسعه (Preview Sandbox)', ip_address: 'local', created_at: '2026-11-25 14:00:00' },
];

export const PREVIEW_VENUS_CANDIDATES = [
  {
    id: -201,
    displayName: 'نیلوفر',
    age: 26,
    city: 'تهران',
    bio: 'علاقه‌مند به کتاب، کافه‌گردی و شب‌های مافیا.',
    lookingFor: 'گفت‌وگوی عمیق و آشنایی واقعی',
    interests: ['کتاب', 'سینما', 'مافیا', 'قهوه'],
    compatibilityScore: 91,
    avatarInitials: 'نی',
    avatarColor: '#be185d',
    phoneVerified: true,
    sharedTraits: ['سینما', 'مافیا'],
  },
  {
    id: -202,
    displayName: 'آرش',
    age: 28,
    city: 'شیراز',
    bio: 'طراح محصول، اهل سفر و بازی حکم.',
    lookingFor: 'دوستی و دورهمی',
    interests: ['طراحی', 'سفر', 'حکم', 'موسیقی'],
    compatibilityScore: 86,
    avatarInitials: 'آر',
    avatarColor: '#0369a1',
    phoneVerified: true,
    sharedTraits: ['حکم', 'موسیقی'],
  },
];

export const PREVIEW_WHISPERS = [
  {
    id: -301,
    content: 'این یک نمونه پیام ناشناس در حالت پیش‌نمایش توسعه است.',
    created_at: '2026-11-25 13:30:00',
    reply_text: null,
    is_read: 0,
  },
];
