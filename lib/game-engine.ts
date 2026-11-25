import crypto from 'crypto';
import { adjustStarsAtomic, getDb } from './db';
import {
  chooseBotCard,
  HokmState,
  playCard,
  Seat,
  selectHokmSuit,
  startNewHokmHand,
  Suit,
  SUIT_META,
} from './hokm-engine';
import { MAFIA_ROLE_META, MafiaRole } from './mafia-engine';
import { calculateAge } from './security';

export type EngineGameType = 'hokm' | 'mafia' | 'quiz' | 'truth_dare';

export interface EnginePlayer {
  id: string;
  userId: number | null;
  name: string;
  avatarInitials: string;
  avatarColor: string;
  isBot: boolean;
  score: number;
  status: 'ready' | 'playing' | 'eliminated' | 'left';
}

export interface AutoMafiaState {
  phase: 'LOBBY' | 'NIGHT_ACTION' | 'DAY_DISCUSSION' | 'VOTING' | 'GAME_OVER';
  dayNumber: number;
  scenario: 'classic' | 'tactical';
  phaseEndsAt: number;
  roles: Record<string, MafiaRole>; // Strictly stripped on public serialization!
  aliveIds: string[];
  nightSummary: string;
  detectiveIntel: Record<string, string>; // Only shown to detective player
  votes: Record<string, string>;
  winner: 'citizens' | 'mafia' | null;
  log: { at: string; text: string; phase: string }[];
}

export interface TruthDareEngineState {
  phase: 'LOBBY' | 'READY_TO_SPIN' | 'SPINNING' | 'CHOOSE_MODE' | 'SHOW_PROMPT' | 'FINISHED';
  category: string;
  roundNumber: number;
  maxRounds: number;
  spinCount: number;
  lastSpinId: string | null;
  targetPlayerIndex: number | null;
  targetPlayerId: string | null;
  targetAngleDeg: number; // Backend-computed authoritative target rotation in degrees
  selectedMode: 'truth' | 'dare' | null;
  activePrompt: {
    id: number;
    mode: 'truth' | 'dare';
    category: string;
    text: string;
    isAdult: boolean;
  } | null;
  usedPromptIds: number[];
  turnDeadline: number | null;
  reactions: { id: string; emoji: string; from: string }[];
  history: { round: number; playerName: string; mode: string; outcome: 'completed' | 'skipped'; promptText: string }[];
}

export interface QuizEngineState {
  phase: 'LOBBY' | 'QUESTION' | 'REVEAL' | 'FINISHED';
  category: string;
  currentIndex: number;
  totalQuestions: number;
  questionIds: number[];
  currentQuestion: {
    id: number;
    category: string;
    question: string;
    options: string[];
    difficulty: string;
    correctIndex: number; // Stripped while phase === 'QUESTION'!
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
}

export interface EngineRoomState {
  roomCode: string;
  gameType: EngineGameType;
  isHangout: boolean;
  hostUserId: number;
  players: EnginePlayer[];
  rewardClaimedBy: number[];
  hokm?: HokmState;
  mafia?: AutoMafiaState;
  truthDare?: TruthDareEngineState;
  quiz?: QuizEngineState;
}

const BOT_AVATARS = [
  { name: 'نیلوفر', initials: 'نر', color: '#6d28d9' },
  { name: 'سارا', initials: 'سک', color: '#0e7490' },
  { name: 'کیان', initials: 'کم', color: '#1d4ed8' },
  { name: 'تارا', initials: 'تف', color: '#9d174d' },
  { name: 'آرمان', initials: 'آی', color: '#047857' },
  { name: 'سپهر', initials: 'سف', color: '#b45309' },
  { name: 'مهسا', initials: 'مر', color: '#7e22ce' },
];

function nowTimeLabel(): string {
  return new Date().toISOString().slice(11, 19);
}

function cryptoShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function cleanupExpiredEngineRooms() {
  const db = getDb();
  db.prepare("DELETE FROM engine_rooms WHERE expires_at < datetime('now')").run();
}

export function checkUserAdultVerified(userId: number): boolean {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT u.phone_verified, p.birth_date, av.status, av.consent_accepted
      FROM users u
      JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN adult_verifications av ON av.user_id = u.id
      WHERE u.id = ?
    `)
    .get(userId) as
    | {
        phone_verified: number;
        birth_date: string | null;
        status: string | null;
        consent_accepted: number | null;
      }
    | undefined;
  const age = calculateAge(row?.birth_date);
  return (
    row?.status === 'verified' &&
    Boolean(row?.phone_verified) &&
    age !== null &&
    age >= 18 &&
    Boolean(row?.consent_accepted)
  );
}

function awardMatchStarsOnce(state: EngineRoomState, userId: number, gameType: EngineGameType, score: number, resultText: string, won: boolean) {
  if (state.rewardClaimedBy.includes(userId)) return null;
  state.rewardClaimedBy.push(userId);
  const stars = won ? 25 : 10;
  const xpGain = won ? 45 : 18;
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      'INSERT INTO game_history (user_id, game_type, score, result, stars_earned, meta_json) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, gameType, Math.max(0, Math.round(score)), resultText, stars, JSON.stringify({ roomCode: state.roomCode }));
    db.prepare('UPDATE users SET xp = xp + ?, level = 1 + ((xp + ?) / 150) WHERE id = ?').run(xpGain, xpGain, userId);
    adjustStarsAtomic(
      userId,
      stars,
      'free',
      'game_reward',
      `پاداش موتور خودکار ${gameType === 'hokm' ? 'حکم' : gameType === 'mafia' ? 'مافیا' : gameType === 'quiz' ? 'کوییز' : 'جرئت و حقیقت'} (${state.roomCode})`
    );
  })();
  return stars;
}

function buildPlayersForGame(
  host: { id: number; displayName: string; initials: string; color: string },
  gameType: EngineGameType,
  customNames?: string[]
): EnginePlayer[] {
  const minCount = gameType === 'hokm' ? 4 : gameType === 'mafia' ? 6 : gameType === 'truth_dare' ? 4 : 4;
  const maxCount = gameType === 'hokm' ? 4 : gameType === 'mafia' ? 10 : gameType === 'truth_dare' ? 8 : 4;

  const players: EnginePlayer[] = [
    {
      id: `u_${host.id}`,
      userId: host.id,
      name: host.displayName,
      avatarInitials: host.initials || host.displayName.slice(0, 2),
      avatarColor: host.color || '#3b82f6',
      isBot: false,
      score: 0,
      status: 'playing',
    },
  ];

  const extraNames = (customNames || [])
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && n !== host.displayName);

  for (let i = 0; i < extraNames.length && players.length < maxCount; i++) {
    const preset = BOT_AVATARS[i % BOT_AVATARS.length];
    players.push({
      id: `p_${i + 2}`,
      userId: null,
      name: extraNames[i],
      avatarInitials: extraNames[i].slice(0, 2),
      avatarColor: preset.color,
      isBot: true,
      score: 0,
      status: 'playing',
    });
  }

  let botIdx = 0;
  while (players.length < minCount) {
    const b = BOT_AVATARS[botIdx % BOT_AVATARS.length];
    botIdx++;
    if (players.some((p) => p.name === b.name)) continue;
    players.push({
      id: `bot_${botIdx}`,
      userId: null,
      name: b.name,
      avatarInitials: b.initials,
      avatarColor: b.color,
      isBot: true,
      score: 0,
      status: 'playing',
    });
  }

  return players;
}

function advanceHokmBotsUntilHuman(state: HokmState): HokmState {
  let current = state;
  let guard = 0;
  while (current.phase === 'PLAYING' && current.turn !== 0 && guard < 20) {
    guard++;
    const botCard = chooseBotCard(current, current.turn);
    if (!botCard) break;
    current = playCard(current, current.turn, botCard.id);
  }
  return current;
}

function initHokmState(targetHands = 3): HokmState {
  const initialHakem = crypto.randomInt(0, 4) as Seat;
  // Give the human player a smooth start: 70% chance human starts as Hakem on round 1 so they can pick trump, else fair random seat
  const chosenHakem: Seat = initialHakem === 3 ? 0 : initialHakem;
  const h = startNewHokmHand(chosenHakem, [0, 0], 1, targetHands);
  return advanceHokmBotsUntilHuman(h);
}

function initAutoMafiaState(players: EnginePlayer[], scenario: 'classic' | 'tactical' = 'classic'): AutoMafiaState {
  const count = players.length;
  const rolePool: MafiaRole[] = [];
  const mafiaCount = count >= 8 ? 3 : 2;
  for (let i = 0; i < mafiaCount; i++) rolePool.push('mafia');
  rolePool.push('doctor', 'detective');
  if (scenario === 'tactical' && count >= 7) rolePool.push('sniper');
  while (rolePool.length < count) rolePool.push('citizen');

  const shuffled = cryptoShuffle(rolePool);
  const roles: Record<string, MafiaRole> = {};
  players.forEach((p, i) => {
    roles[p.id] = shuffled[i];
  });

  return {
    phase: 'NIGHT_ACTION',
    dayNumber: 1,
    scenario,
    phaseEndsAt: Date.now() + 45_000,
    roles,
    aliveIds: players.map((p) => p.id),
    nightSummary: 'شب اول فرارسید. نقش‌ها به‌صورت خودکار و امن توسط موتور مدار توزیع شدند.',
    detectiveIntel: {},
    votes: {},
    winner: null,
    log: [
      {
        at: nowTimeLabel(),
        phase: 'NIGHT',
        text: `موتور خودکار مافیا با ${count} بازیکن آغاز شد. نقش محرمانه هر بازیکن به‌صورت اختصاصی صادر شد.`,
      },
    ],
  };
}

function initTruthDareState(category = 'دوستانه'): TruthDareEngineState {
  return {
    phase: 'READY_TO_SPIN',
    category,
    roundNumber: 1,
    maxRounds: 10,
    spinCount: 0,
    lastSpinId: null,
    targetPlayerIndex: null,
    targetPlayerId: null,
    targetAngleDeg: 0,
    selectedMode: null,
    activePrompt: null,
    usedPromptIds: [],
    turnDeadline: null,
    reactions: [],
    history: [],
  };
}

function initQuizState(category = 'همه'): QuizEngineState {
  const db = getDb();
  const rows =
    category && category !== 'همه'
      ? (db
          .prepare('SELECT id, category, question, options_json, correct_index, difficulty FROM quiz_questions WHERE category = ? ORDER BY RANDOM() LIMIT 6')
          .all(category) as { id: number; category: string; question: string; options_json: string; correct_index: number; difficulty: string }[])
      : (db
          .prepare('SELECT id, category, question, options_json, correct_index, difficulty FROM quiz_questions ORDER BY RANDOM() LIMIT 6')
          .all() as { id: number; category: string; question: string; options_json: string; correct_index: number; difficulty: string }[]);

  const first = rows[0]
    ? {
        id: rows[0].id,
        category: rows[0].category,
        question: rows[0].question,
        options: JSON.parse(rows[0].options_json) as string[],
        difficulty: rows[0].difficulty,
        correctIndex: rows[0].correct_index,
      }
    : null;

  return {
    phase: first ? 'QUESTION' : 'FINISHED',
    category,
    currentIndex: 0,
    totalQuestions: rows.length,
    questionIds: rows.map((r) => r.id),
    currentQuestion: first,
    questionStartedAt: Date.now(),
    questionDurationSec: 18,
    lastAnswer: null,
    streak: 0,
    correctCount: 0,
    rivals: [
      { id: 'r1', name: 'نیلوفر راد', avatarInitials: 'نر', avatarColor: '#6d28d9', score: 0 },
      { id: 'r2', name: 'کیان مهرآذر', avatarInitials: 'کم', avatarColor: '#1d4ed8', score: 0 },
      { id: 'r3', name: 'سارا کاظمی', avatarInitials: 'سک', avatarColor: '#0e7490', score: 0 },
    ],
  };
}

export function createEngineRoom(params: {
  hostUserId: number;
  hostDisplayName: string;
  hostInitials: string;
  hostColor: string;
  gameType: EngineGameType;
  isHangout?: boolean;
  playerNames?: string[];
  category?: string;
  mafiaScenario?: 'classic' | 'tactical';
  hokmTargetHands?: number;
}): EngineRoomState {
  cleanupExpiredEngineRooms();
  const db = getDb();
  const roomCode = `MDR-${crypto.randomInt(1000, 9999)}`;
  const players = buildPlayersForGame(
    {
      id: params.hostUserId,
      displayName: params.hostDisplayName,
      initials: params.hostInitials,
      color: params.hostColor,
    },
    params.gameType,
    params.playerNames
  );

  const state: EngineRoomState = {
    roomCode,
    gameType: params.gameType,
    isHangout: Boolean(params.isHangout),
    hostUserId: params.hostUserId,
    players,
    rewardClaimedBy: [],
  };

  if (params.gameType === 'hokm') {
    state.hokm = initHokmState(params.hokmTargetHands ?? 3);
  } else if (params.gameType === 'mafia') {
    state.mafia = initAutoMafiaState(players, params.mafiaScenario ?? 'classic');
  } else if (params.gameType === 'truth_dare') {
    state.truthDare = initTruthDareState(params.category || 'دوستانه');
  } else if (params.gameType === 'quiz') {
    state.quiz = initQuizState(params.category || 'همه');
  }

  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO engine_rooms (room_code, game_type, is_hangout, host_user_id, status, state_json, expires_at)
    VALUES (?, ?, ?, ?, 'playing', ?, ?)
  `).run(roomCode, params.gameType, params.isHangout ? 1 : 0, params.hostUserId, JSON.stringify(state), expiresAt);

  return state;
}

export function loadEngineRoom(roomCode: string): EngineRoomState | null {
  cleanupExpiredEngineRooms();
  const db = getDb();
  const row = db.prepare('SELECT state_json FROM engine_rooms WHERE room_code = ?').get(roomCode.toUpperCase()) as
    | { state_json: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.state_json) as EngineRoomState;
}

export function saveEngineRoom(state: EngineRoomState, status: 'lobby' | 'playing' | 'finished' = 'playing') {
  const db = getDb();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    UPDATE engine_rooms
    SET game_type = ?, status = ?, state_json = ?, expires_at = ?, updated_at = datetime('now')
    WHERE room_code = ?
  `).run(state.gameType, status, JSON.stringify(state), expiresAt, state.roomCode);
}

/**
 * Security boundary: strips hidden hands, secret Mafia roles, and unrevealed Quiz answers
 * so no player can inspect API payloads to cheat.
 */
export function sanitizeEngineStateForUser(state: EngineRoomState, viewerUserId: number | null) {
  const viewerPlayer = viewerUserId ? state.players.find((p) => p.userId === viewerUserId) : null;

  const safeHokm = state.hokm
    ? {
        ...state.hokm,
        hands: {
          0: state.hokm.phase === 'CHOOSE_HOKM' ? state.hokm.hands[0].slice(0, 5) : state.hokm.hands[0],
          1: [],
          2: [],
          3: [],
        },
        handCounts: {
          0: state.hokm.hands[0].length,
          1: state.hokm.hands[1].length,
          2: state.hokm.hands[2].length,
          3: state.hokm.hands[3].length,
        },
      }
    : undefined;

  const safeMafia = state.mafia
    ? {
        phase: state.mafia.phase,
        dayNumber: state.mafia.dayNumber,
        scenario: state.mafia.scenario,
        phaseEndsAt: state.mafia.phaseEndsAt,
        aliveIds: state.mafia.aliveIds,
        nightSummary: state.mafia.nightSummary,
        votes: state.mafia.votes,
        winner: state.mafia.winner,
        log: state.mafia.log,
        myPlayerId: viewerPlayer?.id ?? state.players[0]?.id ?? null,
        myRole: (() => {
          const pid = viewerPlayer?.id ?? state.players[0]?.id;
          if (!pid) return null;
          const r = state.mafia.roles[pid];
          if (!r) return null;
          return {
            key: r,
            title: MAFIA_ROLE_META[r].fa,
            team: MAFIA_ROLE_META[r].team,
            description: MAFIA_ROLE_META[r].description,
          };
        })(),
        detectiveIntel: (() => {
          const pid = viewerPlayer?.id ?? state.players[0]?.id;
          return pid ? state.mafia.detectiveIntel[pid] || null : null;
        })(),
        // Reveal all roles ONLY after GAME_OVER
        revealedRoles:
          state.mafia.phase === 'GAME_OVER'
            ? Object.fromEntries(
                Object.entries(state.mafia.roles).map(([pid, r]) => [
                  pid,
                  { key: r, title: MAFIA_ROLE_META[r].fa, team: MAFIA_ROLE_META[r].team },
                ])
              )
            : null,
      }
    : undefined;

  const safeQuiz = state.quiz
    ? {
        ...state.quiz,
        currentQuestion: state.quiz.currentQuestion
          ? {
              id: state.quiz.currentQuestion.id,
              category: state.quiz.currentQuestion.category,
              question: state.quiz.currentQuestion.question,
              options: state.quiz.currentQuestion.options,
              difficulty: state.quiz.currentQuestion.difficulty,
              // Never send correctIndex before answer is submitted!
              ...(state.quiz.phase === 'REVEAL' ? { correctIndex: state.quiz.currentQuestion.correctIndex } : {}),
            }
          : null,
      }
    : undefined;

  return {
    roomCode: state.roomCode,
    gameType: state.gameType,
    isHangout: state.isHangout,
    hostUserId: state.hostUserId,
    players: state.players,
    hokm: safeHokm,
    mafia: safeMafia,
    truthDare: state.truthDare,
    quiz: safeQuiz,
  };
}

// ==================== GAME ACTION HANDLERS ====================

export function handleSwitchHangoutGame(
  state: EngineRoomState,
  nextGame: EngineGameType,
  category?: string
): EngineRoomState {
  state.gameType = nextGame;
  state.isHangout = true;
  if (nextGame === 'hokm') {
    while (state.players.length < 4) {
      const b = BOT_AVATARS[state.players.length % BOT_AVATARS.length];
      state.players.push({
        id: `bot_${state.players.length + 1}`,
        userId: null,
        name: b.name,
        avatarInitials: b.initials,
        avatarColor: b.color,
        isBot: true,
        score: 0,
        status: 'playing',
      });
    }
    state.hokm = initHokmState(3);
  } else if (nextGame === 'mafia') {
    while (state.players.length < 6) {
      const b = BOT_AVATARS[state.players.length % BOT_AVATARS.length];
      state.players.push({
        id: `bot_${state.players.length + 1}`,
        userId: null,
        name: b.name,
        avatarInitials: b.initials,
        avatarColor: b.color,
        isBot: true,
        score: 0,
        status: 'playing',
      });
    }
    state.mafia = initAutoMafiaState(state.players, 'classic');
  } else if (nextGame === 'truth_dare') {
    state.truthDare = initTruthDareState(category || 'دوستانه');
  } else if (nextGame === 'quiz') {
    state.quiz = initQuizState(category || 'همه');
  }
  saveEngineRoom(state, 'playing');
  return state;
}

export function handleHokmChooseTrump(state: EngineRoomState, suit: Suit): EngineRoomState {
  if (!state.hokm || state.hokm.phase !== 'CHOOSE_HOKM') {
    throw new Error('در حال حاضر مرحله انتخاب خال حکم نیست.');
  }
  state.hokm = selectHokmSuit(state.hokm, suit);
  saveEngineRoom(state, 'playing');
  return state;
}

export function handleHokmPlayCard(state: EngineRoomState, userId: number, cardId: string): { state: EngineRoomState; starsAwarded: number | null } {
  if (!state.hokm || state.hokm.phase !== 'PLAYING') {
    throw new Error('بازی حکم در مرحله حرکت نیست.');
  }
  if (state.hokm.turn !== 0) {
    throw new Error('هنوز نوبت شما نرسیده است.');
  }
  const beforeLen = state.hokm.hands[0].length;
  let next = playCard(state.hokm, 0, cardId);
  if (next.hands[0].length === beforeLen) {
    throw new Error('این کارت طبق قوانین حکم (رعایت خال زمینه) در این نوبت مجاز نیست.');
  }

  // Let bots auto-play their turns until it's seat 0's turn or hand/match ends
  next = advanceHokmBotsUntilHuman(next);
  state.hokm = next;

  let starsAwarded: number | null = null;
  if (next.phase === 'MATCH_OVER') {
    const won = next.matchScore[0] > next.matchScore[1];
    starsAwarded = awardMatchStarsOnce(
      state,
      userId,
      'hokm',
      next.matchScore[0] * 120 + next.tricksWon[0] * 10,
      won ? `پیروزی ${next.matchScore[0]} بر ${next.matchScore[1]} در حکم` : `پایان مسابقه حکم (${next.matchScore[0]}-${next.matchScore[1]})`,
      won
    );
    saveEngineRoom(state, 'finished');
  } else {
    saveEngineRoom(state, 'playing');
  }
  return { state, starsAwarded };
}

export function handleHokmNextHand(state: EngineRoomState): EngineRoomState {
  if (!state.hokm || state.hokm.phase !== 'HAND_OVER') {
    throw new Error('دست فعلی هنوز به پایان نرسیده است.');
  }
  const next = startNewHokmHand(
    state.hokm.hakem,
    state.hokm.matchScore,
    state.hokm.roundNumber + 1,
    state.hokm.targetHands
  );
  state.hokm = advanceHokmBotsUntilHuman(next);
  saveEngineRoom(state, 'playing');
  return state;
}

function checkAutoMafiaWinner(mafia: AutoMafiaState): 'citizens' | 'mafia' | null {
  const aliveMafia = mafia.aliveIds.filter((id) => mafia.roles[id] === 'mafia').length;
  const aliveCitizens = mafia.aliveIds.filter((id) => mafia.roles[id] !== 'mafia').length;
  if (aliveMafia === 0) return 'citizens';
  if (aliveMafia >= aliveCitizens) return 'mafia';
  return null;
}

export function handleMafiaNightAction(
  state: EngineRoomState,
  userId: number,
  targetId?: string
): { state: EngineRoomState; starsAwarded: number | null } {
  const mafia = state.mafia;
  if (!mafia || mafia.phase !== 'NIGHT_ACTION') {
    throw new Error('بازی مافیا در فاز شب نیست.');
  }

  const human = state.players.find((p) => p.userId === userId) || state.players[0];
  const humanRole = mafia.roles[human.id];
  const aliveSet = new Set(mafia.aliveIds);
  const aliveNonMafia = mafia.aliveIds.filter((id) => mafia.roles[id] !== 'mafia');

  // 1. Determine Mafia shot (if human is alive mafia and picked target, use it; otherwise AI mafia picks)
  let mafiaTarget: string | null = null;
  if (aliveSet.has(human.id) && humanRole === 'mafia' && targetId && aliveSet.has(targetId)) {
    mafiaTarget = targetId;
  } else if (aliveNonMafia.length > 0) {
    mafiaTarget = aliveNonMafia[crypto.randomInt(0, aliveNonMafia.length)];
  }

  // 2. Determine Doctor save
  let doctorTarget: string | null = null;
  const doctorId = mafia.aliveIds.find((id) => mafia.roles[id] === 'doctor');
  if (doctorId) {
    if (doctorId === human.id && targetId && aliveSet.has(targetId)) {
      doctorTarget = targetId;
    } else {
      doctorTarget = mafia.aliveIds[crypto.randomInt(0, mafia.aliveIds.length)];
    }
  }

  // 3. Determine Detective inquiry
  const detectiveId = mafia.aliveIds.find((id) => mafia.roles[id] === 'detective');
  if (detectiveId && detectiveId === human.id && targetId && aliveSet.has(targetId)) {
    const targetPlayer = state.players.find((p) => p.id === targetId);
    const isMafia = mafia.roles[targetId] === 'mafia';
    mafia.detectiveIntel[human.id] = `استعلام کارآگاه از «${targetPlayer?.name}»: ${
      isMafia ? 'تأیید شد — عضو تیم مافیا است!' : 'عضو تیم شهروندان است.'
    }`;
  }

  // 4. Optional Sniper shot if human is sniper and selected a target
  let sniperMsg = '';
  if (aliveSet.has(human.id) && humanRole === 'sniper' && targetId && targetId !== human.id && aliveSet.has(targetId)) {
    const targetPlayer = state.players.find((p) => p.id === targetId);
    if (mafia.roles[targetId] === 'mafia') {
      mafia.aliveIds = mafia.aliveIds.filter((id) => id !== targetId);
      sniperMsg = ` تک‌تیرانداز با شلیک دقیق «${targetPlayer?.name}» (مافیا) را حذف کرد!`;
    } else {
      mafia.aliveIds = mafia.aliveIds.filter((id) => id !== human.id);
      sniperMsg = ` تک‌تیرانداز به اشتباه شهروند را هدف گرفت و خودش از بازی خارج شد!`;
    }
  }

  // 5. Resolve Mafia shot vs Doctor save
  let summary = `صبح روز ${mafia.dayNumber}: شهر بدون کشته بیدار شد — دکتر هدف شب را نجات داد!`;
  if (mafiaTarget && mafiaTarget !== doctorTarget && mafia.aliveIds.includes(mafiaTarget)) {
    mafia.aliveIds = mafia.aliveIds.filter((id) => id !== mafiaTarget);
    const victim = state.players.find((p) => p.id === mafiaTarget);
    summary = `صبح روز ${mafia.dayNumber}: «${victim?.name}» در تاریکی شب از شهر حذف شد.`;
  }
  summary += sniperMsg;

  state.players = state.players.map((p) => ({
    ...p,
    status: mafia.aliveIds.includes(p.id) ? 'playing' : 'eliminated',
  }));

  mafia.nightSummary = summary;
  mafia.log.unshift({ at: nowTimeLabel(), phase: 'DAY', text: summary });

  const winner = checkAutoMafiaWinner(mafia);
  let starsAwarded: number | null = null;
  if (winner) {
    mafia.winner = winner;
    mafia.phase = 'GAME_OVER';
    const humanWon =
      (winner === 'citizens' && humanRole !== 'mafia') || (winner === 'mafia' && humanRole === 'mafia');
    starsAwarded = awardMatchStarsOnce(
      state,
      userId,
      'mafia',
      humanWon ? 260 : 100,
      winner === 'citizens' ? 'پیروزی تیم شهروندان در مافیا' : 'پیروزی تیم مافیا',
      humanWon
    );
    saveEngineRoom(state, 'finished');
  } else {
    mafia.phase = 'DAY_DISCUSSION';
    mafia.phaseEndsAt = Date.now() + 60_000;
    saveEngineRoom(state, 'playing');
  }

  return { state, starsAwarded };
}

export function handleMafiaStartVote(state: EngineRoomState): EngineRoomState {
  if (!state.mafia || state.mafia.phase !== 'DAY_DISCUSSION') {
    throw new Error('فاز گفت‌وگوی روز فعال نیست.');
  }
  state.mafia.phase = 'VOTING';
  state.mafia.votes = {};
  state.mafia.phaseEndsAt = Date.now() + 35_000;
  state.mafia.log.unshift({
    at: nowTimeLabel(),
    phase: 'VOTING',
    text: `رأی‌گیری خودکار روز ${state.mafia.dayNumber} آغاز شد.`,
  });
  saveEngineRoom(state, 'playing');
  return state;
}

export function handleMafiaVote(
  state: EngineRoomState,
  userId: number,
  targetId: string
): { state: EngineRoomState; starsAwarded: number | null } {
  const mafia = state.mafia;
  if (!mafia || mafia.phase !== 'VOTING') {
    throw new Error('فاز رأی‌گیری مافیا فعال نیست.');
  }
  const human = state.players.find((p) => p.userId === userId) || state.players[0];
  if (mafia.aliveIds.includes(human.id) && mafia.aliveIds.includes(targetId)) {
    mafia.votes[human.id] = targetId;
  }

  // Bots automatically cast intelligent votes
  for (const pid of mafia.aliveIds) {
    if (pid === human.id) continue;
    const role = mafia.roles[pid];
    const candidates = mafia.aliveIds.filter((cid) => cid !== pid && (role === 'mafia' ? mafia.roles[cid] !== 'mafia' : true));
    if (candidates.length > 0) {
      mafia.votes[pid] = candidates[crypto.randomInt(0, candidates.length)];
    }
  }

  // Tally votes
  const tally = new Map<string, number>();
  for (const votedId of Object.values(mafia.votes)) {
    tally.set(votedId, (tally.get(votedId) ?? 0) + 1);
  }
  let topId: string | null = null;
  let topVotes = 0;
  let tied = false;
  for (const [cid, count] of tally.entries()) {
    if (count > topVotes) {
      topId = cid;
      topVotes = count;
      tied = false;
    } else if (count === topVotes) {
      tied = true;
    }
  }

  let outcomeText = `در رأی‌گیری روز ${mafia.dayNumber} آرا برابر شد و هیچ‌کس از شهر خارج نشد.`;
  if (topId && !tied) {
    const eliminated = state.players.find((p) => p.id === topId);
    mafia.aliveIds = mafia.aliveIds.filter((id) => id !== topId);
    outcomeText = `با ${topVotes} رأی، «${eliminated?.name}» از شهر خارج شد.`;
  }

  state.players = state.players.map((p) => ({
    ...p,
    status: mafia.aliveIds.includes(p.id) ? 'playing' : 'eliminated',
  }));

  mafia.log.unshift({ at: nowTimeLabel(), phase: 'VOTING', text: outcomeText });
  const winner = checkAutoMafiaWinner(mafia);
  let starsAwarded: number | null = null;

  if (winner) {
    mafia.winner = winner;
    mafia.phase = 'GAME_OVER';
    const humanRole = mafia.roles[human.id];
    const humanWon =
      (winner === 'citizens' && humanRole !== 'mafia') || (winner === 'mafia' && humanRole === 'mafia');
    starsAwarded = awardMatchStarsOnce(
      state,
      userId,
      'mafia',
      humanWon ? 260 : 100,
      winner === 'citizens' ? 'پیروزی شهروندان در مافیا' : 'پیروزی مافیا',
      humanWon
    );
    saveEngineRoom(state, 'finished');
  } else {
    mafia.dayNumber += 1;
    mafia.phase = 'NIGHT_ACTION';
    mafia.votes = {};
    mafia.phaseEndsAt = Date.now() + 45_000;
    mafia.log.unshift({
      at: nowTimeLabel(),
      phase: 'NIGHT',
      text: `شب ${mafia.dayNumber} آغاز شد. نقش‌های شب حرکت خود را ثبت کنند.`,
    });
    saveEngineRoom(state, 'playing');
  }

  return { state, starsAwarded };
}

export function handleTruthDareSpin(state: EngineRoomState, category?: string): EngineRoomState {
  const td = state.truthDare;
  if (!td) throw new Error('وضعیت اتاق جرئت و حقیقت یافت نشد.');
  if (category) td.category = category;

  const activePlayers = state.players.filter((p) => p.status !== 'left');
  if (activePlayers.length < 2) {
    throw new Error('برای چرخاندن بطری حداقل ۲ بازیکن لازم است.');
  }

  // Cryptographically authoritative random player selection on Backend
  const chosenIdx = crypto.randomInt(0, activePlayers.length);
  const chosenPlayer = activePlayers[chosenIdx];
  const seatAngleDeg = (360 / activePlayers.length) * chosenIdx;
  const extraFullSpins = (4 + crypto.randomInt(0, 4)) * 360;
  // Accumulate monotonically so the 3D bottle always spins forward naturally
  const currentBase = Math.floor(td.targetAngleDeg / 360) * 360;
  const targetAngleDeg = currentBase + extraFullSpins + seatAngleDeg;

  td.spinCount += 1;
  td.lastSpinId = crypto.randomUUID();
  td.targetPlayerIndex = chosenIdx;
  td.targetPlayerId = chosenPlayer.id;
  td.targetAngleDeg = targetAngleDeg;
  td.selectedMode = null;
  td.activePrompt = null;
  td.phase = 'CHOOSE_MODE';
  td.turnDeadline = Date.now() + 45_000;

  saveEngineRoom(state, 'playing');
  return state;
}

export function handleTruthDareChooseMode(
  state: EngineRoomState,
  userId: number,
  mode: 'truth' | 'dare',
  category?: string
): EngineRoomState {
  const td = state.truthDare;
  if (!td) throw new Error('اتاق جرئت و حقیقت فعال نیست.');
  const cat = category || td.category || 'همه';
  td.category = cat;

  const isAdultVerified = checkUserAdultVerified(userId);
  if (cat === 'بزرگسالان ۱۸+' && !isAdultVerified) {
    throw new Error('حالت بزرگسالان ۱۸+ فقط پس از تکمیل احراز چندلایه سن و رضایت در بخش پروفایل باز می‌شود.');
  }

  const db = getDb();
  let rows = db
    .prepare(
      isAdultVerified
        ? 'SELECT id, mode, category, text, is_adult FROM truth_dare_prompts WHERE mode = ?'
        : 'SELECT id, mode, category, text, is_adult FROM truth_dare_prompts WHERE mode = ? AND is_adult = 0'
    )
    .all(mode) as { id: number; mode: 'truth' | 'dare'; category: string; text: string; is_adult: number }[];

  if (cat !== 'همه') {
    const filtered = rows.filter((r) => r.category === cat);
    if (filtered.length > 0) rows = filtered;
  }

  const unused = rows.filter((r) => !td.usedPromptIds.includes(r.id));
  const pool = unused.length > 0 ? unused : rows;
  if (pool.length === 0) {
    throw new Error('سؤال یا چالشی در این دسته‌بندی موجود نیست.');
  }

  const picked = pool[crypto.randomInt(0, pool.length)];
  td.selectedMode = mode;
  td.activePrompt = {
    id: picked.id,
    mode: picked.mode,
    category: picked.category,
    text: picked.text,
    isAdult: Boolean(picked.is_adult),
  };
  if (!td.usedPromptIds.includes(picked.id)) {
    td.usedPromptIds.push(picked.id);
  }
  td.phase = 'SHOW_PROMPT';
  td.turnDeadline = Date.now() + 60_000;

  saveEngineRoom(state, 'playing');
  return state;
}

export function handleTruthDareResolveTurn(
  state: EngineRoomState,
  userId: number,
  outcome: 'completed' | 'skipped'
): { state: EngineRoomState; starsAwarded: number | null } {
  const td = state.truthDare;
  if (!td) throw new Error('اتاق جرئت و حقیقت یافت نشد.');

  const targetPlayer = state.players.find((p) => p.id === td.targetPlayerId);
  if (outcome === 'completed' && targetPlayer) {
    targetPlayer.score += 30;
  }
  if (td.activePrompt && targetPlayer) {
    td.history.unshift({
      round: td.roundNumber,
      playerName: targetPlayer.name,
      mode: td.selectedMode === 'truth' ? 'حقیقت' : 'جرئت',
      outcome,
      promptText: td.activePrompt.text,
    });
  }

  td.roundNumber += 1;
  td.activePrompt = null;
  td.selectedMode = null;
  td.turnDeadline = null;

  let starsAwarded: number | null = null;
  if (td.roundNumber > td.maxRounds) {
    td.phase = 'FINISHED';
    const myScore = state.players.find((p) => p.userId === userId)?.score ?? 90;
    starsAwarded = awardMatchStarsOnce(
      state,
      userId,
      'truth_dare',
      Math.max(60, myScore),
      `تکمیل ${td.maxRounds} دور جرئت و حقیقت دورهمی`,
      true
    );
    saveEngineRoom(state, 'finished');
  } else {
    td.phase = 'READY_TO_SPIN';
    // Also reward partial stars after 3 completed turns if not yet claimed
    const completedCount = td.history.filter((h) => h.outcome === 'completed').length;
    if (completedCount === 3) {
      starsAwarded = awardMatchStarsOnce(state, userId, 'truth_dare', 120, 'تکمیل ۳ چالش جرئت و حقیقت', true);
    }
    saveEngineRoom(state, 'playing');
  }

  return { state, starsAwarded };
}

export function handleQuizAnswer(
  state: EngineRoomState,
  userId: number,
  selectedIndex: number
): { state: EngineRoomState; starsAwarded: number | null } {
  const qz = state.quiz;
  if (!qz || qz.phase !== 'QUESTION' || !qz.currentQuestion) {
    throw new Error('سؤال فعالی برای پاسخ‌گویی وجود ندارد.');
  }

  const elapsedSec = Math.max(0, (Date.now() - qz.questionStartedAt) / 1000);
  const remainingSec = Math.max(0, Math.round(qz.questionDurationSec - elapsedSec));
  const isCorrect = selectedIndex === qz.currentQuestion.correctIndex;

  let pointsGained = 0;
  if (isCorrect) {
    qz.streak += 1;
    qz.correctCount += 1;
    pointsGained = 100 + remainingSec * 12 + (qz.streak > 1 ? 25 : 0);
    const me = state.players.find((p) => p.userId === userId) || state.players[0];
    if (me) me.score += pointsGained;
  } else {
    qz.streak = 0;
  }

  // Update simulated live rivals
  for (const r of qz.rivals) {
    const rivalGotRight = crypto.randomInt(0, 100) < 68;
    if (rivalGotRight) {
      r.score += 100 + crypto.randomInt(4, 15) * 10;
    }
  }

  qz.lastAnswer = {
    selectedIndex,
    correctIndex: qz.currentQuestion.correctIndex,
    isCorrect,
    pointsGained,
    streak: qz.streak,
  };
  qz.phase = 'REVEAL';
  saveEngineRoom(state, 'playing');
  return { state, starsAwarded: null };
}

export function handleQuizNext(
  state: EngineRoomState,
  userId: number
): { state: EngineRoomState; starsAwarded: number | null } {
  const qz = state.quiz;
  if (!qz) throw new Error('اتاق کوییز فعال نیست.');

  const nextIdx = qz.currentIndex + 1;
  if (nextIdx >= qz.questionIds.length) {
    qz.phase = 'FINISHED';
    qz.currentQuestion = null;
    const me = state.players.find((p) => p.userId === userId) || state.players[0];
    const myScore = me?.score ?? 0;
    const topRival = Math.max(...qz.rivals.map((r) => r.score), 0);
    const won = myScore >= topRival && qz.correctCount >= 3;
    const starsAwarded = awardMatchStarsOnce(
      state,
      userId,
      'quiz',
      myScore,
      `پاسخ صحیح ${qz.correctCount} از ${qz.totalQuestions} در لیگ عطارد`,
      won
    );
    saveEngineRoom(state, 'finished');
    return { state, starsAwarded };
  }

  const db = getDb();
  const nextId = qz.questionIds[nextIdx];
  const row = db
    .prepare('SELECT id, category, question, options_json, correct_index, difficulty FROM quiz_questions WHERE id = ?')
    .get(nextId) as { id: number; category: string; question: string; options_json: string; correct_index: number; difficulty: string } | undefined;

  if (!row) {
    qz.phase = 'FINISHED';
    saveEngineRoom(state, 'finished');
    return { state, starsAwarded: null };
  }

  qz.currentIndex = nextIdx;
  qz.currentQuestion = {
    id: row.id,
    category: row.category,
    question: row.question,
    options: JSON.parse(row.options_json) as string[],
    difficulty: row.difficulty,
    correctIndex: row.correct_index,
  };
  qz.questionStartedAt = Date.now();
  qz.lastAnswer = null;
  qz.phase = 'QUESTION';
  saveEngineRoom(state, 'playing');
  return { state, starsAwarded: null };
}

export const SUIT_LABEL_LOOKUP = SUIT_META;
