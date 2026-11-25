export type MainView =
  | 'home'
  | 'venus'
  | 'games'
  | 'whisper'
  | 'profile'
  | 'saturn'
  | 'shop'
  | 'admin';

export type GameSubTab = 'hangout' | 'hokm' | 'mafia' | 'quiz' | 'truth';

export interface PlanetConfig {
  id: string;
  name: string;
  subtitle: string;
  target: string;
  color: string;
  image: string;
}

export interface ConstellationFriend {
  id: number;
  username: string;
  display_name: string;
  level: number;
  avatar_initials: string;
  avatar_color: string;
  created_at: string;
}

export interface PlanetEvolutionState {
  stage: number;
  title: string;
  subtitle: string;
  ringAccent: string;
  auraStyle: string;
  evolutionScore: number;
  nextStageTitle: string | null;
  pointsToNext: number;
  progressPercent: number;
}

export interface SeparatedDatingProfile {
  exists: boolean;
  isActive: boolean;
  datingBio: string;
  lookingFor: string;
  minAge: number;
  maxAge: number;
  genderPref: string;
  showCity: boolean;
  activatedAt: string | null;
}

export interface AdultVerificationState {
  status: 'unverified' | 'pending_review' | 'verified' | 'rejected';
  phoneVerified: boolean;
  birthDateOver18: boolean;
  consentAccepted: boolean;
  isAdultContentAllowed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface MadarUser {
  id: number;
  telegram_id: string | null;
  username: string;
  display_name: string;
  phoneMasked: string | null;
  phone_verified: number;
  role: string;
  subscription_tier: 'free' | 'plus' | 'vip';
  level: number;
  xp: number;
  referral_code: string;
  anon_slug: string;
  allow_whispers: number;
  avatar_color: string;
  avatar_initials: string;
  gender: string;
  birth_date: string | null;
  age: number | null;
  isAdult: boolean;
  isAdultVerified: boolean;
  adultVerification: AdultVerificationState;
  datingProfile: SeparatedDatingProfile;
  constellationFriends: ConstellationFriend[];
  earnedBadges: { id: string; title: string; tone: string }[];
  planetEvolution: PlanetEvolutionState;
  city: string;
  province: string;
  cultural_bg: string;
  bio: string;
  interests: string[];
  relationship_status: string;
  goal: string;
  preferred_connection: string;
  favorite_planet: string;
  equipped_frame: string;
  equipped_badge: string;
  hide_city: number;
  hide_online: number;
  dating_enabled: number;
  use_personality_in_matching: number;
  free_stars: number;
  paid_stars: number;
  totalStars: number;
  referralCount: number;
  gamesPlayedCount: number;
}

export interface UserSessionItem {
  id: string;
  device_label: string;
  ip_address: string;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  is_read: number;
  created_at: string;
}

export interface MissionItem {
  id: string;
  title: string;
  description: string;
  reward_stars: number;
  action_target: string;
  claimed: boolean;
}

export interface SanitizedEngineRoom {
  roomCode: string;
  gameType: 'hokm' | 'mafia' | 'quiz' | 'truth_dare';
  isHangout: boolean;
  hostUserId: number;
  players: {
    id: string;
    userId: number | null;
    name: string;
    avatarInitials: string;
    avatarColor: string;
    isBot: boolean;
    score: number;
    status: 'ready' | 'playing' | 'eliminated' | 'left';
  }[];
  hokm?: import('@/lib/hokm-engine').HokmState & {
    handCounts: { 0: number; 1: number; 2: number; 3: number };
  };
  mafia?: {
    phase: 'LOBBY' | 'NIGHT_ACTION' | 'DAY_DISCUSSION' | 'VOTING' | 'GAME_OVER';
    dayNumber: number;
    scenario: 'classic' | 'tactical';
    phaseEndsAt: number;
    aliveIds: string[];
    nightSummary: string;
    votes: Record<string, string>;
    winner: 'citizens' | 'mafia' | null;
    log: { at: string; text: string; phase: string }[];
    myPlayerId: string | null;
    myRole: { key: string; title: string; team: string; description: string } | null;
    detectiveIntel: string | null;
    revealedRoles: Record<string, { key: string; title: string; team: string }> | null;
  };
  truthDare?: {
    phase: 'LOBBY' | 'READY_TO_SPIN' | 'SPINNING' | 'CHOOSE_MODE' | 'SHOW_PROMPT' | 'FINISHED';
    category: string;
    roundNumber: number;
    maxRounds: number;
    spinCount: number;
    lastSpinId: string | null;
    targetPlayerIndex: number | null;
    targetPlayerId: string | null;
    targetAngleDeg: number;
    selectedMode: 'truth' | 'dare' | null;
    activePrompt: {
      id: number;
      mode: 'truth' | 'dare';
      category: string;
      text: string;
      isAdult: boolean;
    } | null;
    turnDeadline: number | null;
    reactions: { id: string; emoji: string; from: string }[];
    history: { round: number; playerName: string; mode: string; outcome: 'completed' | 'skipped'; promptText: string }[];
  };
  quiz?: {
    phase: 'LOBBY' | 'QUESTION' | 'REVEAL' | 'FINISHED';
    category: string;
    currentIndex: number;
    totalQuestions: number;
    currentQuestion: {
      id: number;
      category: string;
      question: string;
      options: string[];
      difficulty: string;
      correctIndex?: number;
    } | null;
    questionStartedAt: number;
    questionDurationSec: number;
    lastAnswer: {
      selectedIndex: number;
      correctIndex: number;
      isCorrect: boolean;
      pointsGained: number;
      streak: number;
    } | null;
    streak: number;
    correctCount: number;
    rivals: { id: string; name: string; avatarInitials: string; avatarColor: string; score: number }[];
  };
}
