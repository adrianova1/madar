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
import { ADULT_TD_CATEGORY } from './truth-dare-prompts';

export type EngineGameType = 'hokm' | 'mafia' | 'quiz' | 'truth_dare';

export class GameEngineError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'GameEngineError';
    this.statusCode = statusCode;
  }
}

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
  hokmTurnDeadline?: number | null;
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

const HOKM_TURN_MS = 35_000;
const MAFIA_NIGHT_MS = 45_000;
const MAFIA_DAY_MS = 60_000;
const MAFIA_VOTE_MS = 35_000;
const TD_CHOOSE_MS = 45_000;
const TD_PROMPT_MS = 60_000;

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

export function assertRoomMember(state: EngineRoomState, userId: number): EnginePlayer {
  const player = state.players.find((p) => p.userId === userId && p.status !== 'left');
  if (!player) {
    throw new GameEngineError('شما عضو این اتاق بازی نیستید. ابتدا با کد اتاق وارد شوید.', 403);
  }
  return player;
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

function awardMatchStarsOnce(
  state: EngineRoomState,
  userId: number,
  gameType: EngineGameType,
  score: number,
  resultText: string,
  won: boolean
) {
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
      `پاداش موتور بازی ${gameType === 'hokm' ? 'حکم' : gameType === 'mafia' ? 'مافیا' : gameType === 'quiz' ? 'کوییز' : 'جرئت و حقیقت'} (${state.roomCode})`
    );
  })();
  return stars;
}

function buildPlayersForGame(
  host: { id: number; displayName: string; initials: string; color: string },
  gameType: EngineGameType,
  customNames?: string[]
): EnginePlayer[] {
  const minCount = gameType === 'hokm' ? 4 : gameType === 'mafia' ? 6 : 4;
  const maxCount = gameType === 'hokm' ? 4 : gameType === 'mafia' ? 10 : gameType === 'truth_dare' ? 8 : 4;

  const players: EnginePlayer[] = [
    {
      id: `u_${host.id}`,
      userId: host.id,
      name: host.displayName,
      avatarInitials: host.initials || host.displayName.slice(0, 2),
      avatarColor: host.color || '#38bdf8',
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

function isSeatHuman(players: EnginePlayer[], seat: Seat): boolean {
  const p = players[seat];
  return Boolean(p && !p.isBot && p.status !== 'left');
}

function advanceHokmBotsUntilHuman(hokm: HokmState, players: EnginePlayer[]): HokmState {
  let current = hokm;
  let guard = 0;
  while (current.phase === 'PLAYING' && !isSeatHuman(players, current.turn) && guard < 24) {
    guard++;
    const botCard = chooseBotCard(current, current.turn);
    if (!botCard) break;
    current = playCard(current, current.turn, botCard.id);
  }
  return current;
}

function initHokmState(players: EnginePlayer[], targetHands = 3): HokmState {
  const initialHakem = crypto.randomInt(0, 4) as Seat;
  const chosenHakem: Seat = initialHakem === 3 ? 0 : initialHakem;
  const h = startNewHokmHand(chosenHakem, [0, 0], 1, targetHands);
  return advanceHokmBotsUntilHuman(h, players);
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
    phaseEndsAt: Date.now() + MAFIA_NIGHT_MS,
    roles,
    aliveIds: players.map((p) => p.id),
    nightSummary: 'شب اول شروع شد. نقش مخفی هر بازیکن به‌صورت اختصاصی صادر شد.',
    detectiveIntel: {},
    votes: {},
    winner: null,
    log: [
      {
        at: nowTimeLabel(),
        phase: 'NIGHT',
        text: `بازی مافیا با ${count} بازیکن آغاز شد.`,
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

  const safeCategory =
    params.category === ADULT_TD_CATEGORY && !checkUserAdultVerified(params.hostUserId)
      ? 'دوستانه'
      : params.category;

  const state: EngineRoomState = {
    roomCode,
    gameType: params.gameType,
    isHangout: Boolean(params.isHangout),
    hostUserId: params.hostUserId,
    players,
    rewardClaimedBy: [],
    hokmTurnDeadline: null,
  };

  if (params.gameType === 'hokm') {
    state.hokm = initHokmState(players, params.hokmTargetHands ?? 3);
    state.hokmTurnDeadline = state.hokm.phase === 'PLAYING' ? Date.now() + HOKM_TURN_MS : null;
  } else if (params.gameType === 'mafia') {
    state.mafia = initAutoMafiaState(players, params.mafiaScenario ?? 'classic');
  } else if (params.gameType === 'truth_dare') {
    state.truthDare = initTruthDareState(safeCategory || 'دوستانه');
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

function checkAutoMafiaWinner(mafia: AutoMafiaState): 'citizens' | 'mafia' | null {
  const aliveMafia = mafia.aliveIds.filter((id) => mafia.roles[id] === 'mafia').length;
  const aliveCitizens = mafia.aliveIds.filter((id) => mafia.roles[id] !== 'mafia').length;
  if (aliveMafia === 0) return 'citizens';
  if (aliveMafia >= aliveCitizens) return 'mafia';
  return null;
}

function resolveMafiaNightInternal(
  state: EngineRoomState,
  actorPlayer: EnginePlayer | null,
  targetId?: string,
  timedOut = false
): number | null {
  const mafia = state.mafia;
  if (!mafia || mafia.phase !== 'NIGHT_ACTION') return null;

  const actorRole = actorPlayer ? mafia.roles[actorPlayer.id] : null;
  const aliveSet = new Set(mafia.aliveIds);
  const aliveNonMafia = mafia.aliveIds.filter((id) => mafia.roles[id] !== 'mafia');

  let mafiaTarget: string | null = null;
  if (actorPlayer && aliveSet.has(actorPlayer.id) && actorRole === 'mafia' && targetId && aliveSet.has(targetId)) {
    mafiaTarget = targetId;
  } else if (aliveNonMafia.length > 0) {
    mafiaTarget = aliveNonMafia[crypto.randomInt(0, aliveNonMafia.length)];
  }

  let doctorTarget: string | null = null;
  const doctorId = mafia.aliveIds.find((id) => mafia.roles[id] === 'doctor');
  if (doctorId) {
    if (actorPlayer && doctorId === actorPlayer.id && targetId && aliveSet.has(targetId)) {
      doctorTarget = targetId;
    } else {
      doctorTarget = mafia.aliveIds[crypto.randomInt(0, mafia.aliveIds.length)];
    }
  }

  const detectiveId = mafia.aliveIds.find((id) => mafia.roles[id] === 'detective');
  if (actorPlayer && detectiveId && detectiveId === actorPlayer.id && targetId && aliveSet.has(targetId)) {
    const targetPlayer = state.players.find((p) => p.id === targetId);
    const isMafia = mafia.roles[targetId] === 'mafia';
    mafia.detectiveIntel[actorPlayer.id] = `استعلام «${targetPlayer?.name}»: ${
      isMafia ? 'عضو تیم مافیاست!' : 'شهروند است.'
    }`;
  }

  let sniperMsg = '';
  if (
    actorPlayer &&
    aliveSet.has(actorPlayer.id) &&
    actorRole === 'sniper' &&
    targetId &&
    targetId !== actorPlayer.id &&
    aliveSet.has(targetId)
  ) {
    const targetPlayer = state.players.find((p) => p.id === targetId);
    if (mafia.roles[targetId] === 'mafia') {
      mafia.aliveIds = mafia.aliveIds.filter((id) => id !== targetId);
      sniperMsg = ` تک‌تیرانداز «${targetPlayer?.name}» (مافیا) را حذف کرد!`;
    } else {
      mafia.aliveIds = mafia.aliveIds.filter((id) => id !== actorPlayer.id);
      sniperMsg = ` تک‌تیرانداز اشتباه شلیک کرد و حذف شد!`;
    }
  }

  let summary = `صبح روز ${mafia.dayNumber}: شب بدون کشته گذشت (دکتر نجات داد).`;
  if (mafiaTarget && mafiaTarget !== doctorTarget && mafia.aliveIds.includes(mafiaTarget)) {
    mafia.aliveIds = mafia.aliveIds.filter((id) => id !== mafiaTarget);
    const victim = state.players.find((p) => p.id === mafiaTarget);
    summary = `صبح روز ${mafia.dayNumber}: «${victim?.name}» در شب از بازی خارج شد.`;
  }
  if (timedOut) {
    summary = `[پایان زمان شب] ${summary}`;
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
    if (actorPlayer?.userId) {
      const humanWon =
        (winner === 'citizens' && actorRole !== 'mafia') || (winner === 'mafia' && actorRole === 'mafia');
      starsAwarded = awardMatchStarsOnce(
        state,
        actorPlayer.userId,
        'mafia',
        humanWon ? 260 : 100,
        winner === 'citizens' ? 'پیروزی شهروندان در مافیا' : 'پیروزی مافیا',
        humanWon
      );
    }
  } else {
    mafia.phase = 'DAY_DISCUSSION';
    mafia.phaseEndsAt = Date.now() + MAFIA_DAY_MS;
  }
  return starsAwarded;
}

function resolveMafiaVoteInternal(
  state: EngineRoomState,
  actorPlayer: EnginePlayer | null,
  targetId?: string,
  timedOut = false
): number | null {
  const mafia = state.mafia;
  if (!mafia || mafia.phase !== 'VOTING') return null;

  if (actorPlayer && targetId && mafia.aliveIds.includes(actorPlayer.id) && mafia.aliveIds.includes(targetId)) {
    mafia.votes[actorPlayer.id] = targetId;
  }

  // Bots (and any unvoted players on timeout) cast votes
  for (const pid of mafia.aliveIds) {
    if (mafia.votes[pid]) continue;
    const pObj = state.players.find((p) => p.id === pid);
    if (!timedOut && pObj && !pObj.isBot && actorPlayer && pid !== actorPlayer.id) {
      // Other human hasn't voted yet — bots still vote below
    }
    const role = mafia.roles[pid];
    const candidates = mafia.aliveIds.filter(
      (cid) => cid !== pid && (role === 'mafia' ? mafia.roles[cid] !== 'mafia' : true)
    );
    if (candidates.length > 0) {
      mafia.votes[pid] = candidates[crypto.randomInt(0, candidates.length)];
    }
  }

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

  let outcomeText = `رأی‌گیری روز ${mafia.dayNumber} مساوی شد و کسی حذف نشد.`;
  if (topId && !tied) {
    const eliminated = state.players.find((p) => p.id === topId);
    mafia.aliveIds = mafia.aliveIds.filter((id) => id !== topId);
    outcomeText = `با ${topVotes} رأی، «${eliminated?.name}» از شهر خارج شد.`;
  }
  if (timedOut) {
    outcomeText = `[پایان مهلت رأی‌گیری] ${outcomeText}`;
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
    if (actorPlayer?.userId) {
      const humanRole = mafia.roles[actorPlayer.id];
      const humanWon =
        (winner === 'citizens' && humanRole !== 'mafia') || (winner === 'mafia' && humanRole === 'mafia');
      starsAwarded = awardMatchStarsOnce(
        state,
        actorPlayer.userId,
        'mafia',
        humanWon ? 260 : 100,
        winner === 'citizens' ? 'پیروزی شهروندان در مافیا' : 'پیروزی مافیا',
        humanWon
      );
    }
  } else {
    mafia.dayNumber += 1;
    mafia.phase = 'NIGHT_ACTION';
    mafia.votes = {};
    mafia.phaseEndsAt = Date.now() + MAFIA_NIGHT_MS;
    mafia.log.unshift({
      at: nowTimeLabel(),
      phase: 'NIGHT',
      text: `شب ${mafia.dayNumber} آغاز شد.`,
    });
  }
  return starsAwarded;
}

/**
 * Server-authoritative timer reconciliation:
 * Advances expired phases across Mafia, Truth or Dare, Quiz, and Hokm even if players disconnect.
 */
export function reconcileRoomTimers(state: EngineRoomState): boolean {
  let changed = false;
  const now = Date.now();

  // 1. Mafia timers
  if (state.gameType === 'mafia' && state.mafia) {
    let guard = 0;
    while (state.mafia.phase !== 'GAME_OVER' && now >= state.mafia.phaseEndsAt && guard < 3) {
      guard++;
      changed = true;
      if (state.mafia.phase === 'NIGHT_ACTION') {
        resolveMafiaNightInternal(state, null, undefined, true);
      } else if (state.mafia.phase === 'DAY_DISCUSSION') {
        state.mafia.phase = 'VOTING';
        state.mafia.votes = {};
        state.mafia.phaseEndsAt = now + MAFIA_VOTE_MS;
        state.mafia.log.unshift({
          at: nowTimeLabel(),
          phase: 'VOTING',
          text: `[پایان زمان بحث] رأی‌گیری روز ${state.mafia.dayNumber} آغاز شد.`,
        });
      } else if (state.mafia.phase === 'VOTING') {
        resolveMafiaVoteInternal(state, null, undefined, true);
      } else {
        break;
      }
    }
  }

  // 2. Truth or Dare timers
  if (state.gameType === 'truth_dare' && state.truthDare && state.truthDare.turnDeadline && now >= state.truthDare.turnDeadline) {
    const td = state.truthDare;
    if (td.phase === 'CHOOSE_MODE' || td.phase === 'SHOW_PROMPT') {
      changed = true;
      const targetPlayer = state.players.find((p) => p.id === td.targetPlayerId);
      if (targetPlayer) {
        td.history.unshift({
          round: td.roundNumber,
          playerName: targetPlayer.name,
          mode: td.selectedMode === 'truth' ? 'حقیقت' : td.selectedMode === 'dare' ? 'جرئت' : 'رد نوبت',
          outcome: 'skipped',
          promptText: td.activePrompt?.text || 'مهلت انتخاب به پایان رسید و نوبت به نفر بعد منتقل شد.',
        });
      }
      td.roundNumber += 1;
      td.activePrompt = null;
      td.selectedMode = null;
      td.turnDeadline = null;
      td.phase = td.roundNumber > td.maxRounds ? 'FINISHED' : 'READY_TO_SPIN';
    }
  }

  // 3. Quiz timer
  if (state.gameType === 'quiz' && state.quiz && state.quiz.phase === 'QUESTION' && state.quiz.currentQuestion) {
    const deadline = state.quiz.questionStartedAt + state.quiz.questionDurationSec * 1000;
    if (now >= deadline) {
      changed = true;
      state.quiz.streak = 0;
      for (const r of state.quiz.rivals) {
        if (crypto.randomInt(0, 100) < 68) {
          r.score += 100 + crypto.randomInt(4, 15) * 10;
        }
      }
      state.quiz.lastAnswer = {
        selectedIndex: -1,
        correctIndex: state.quiz.currentQuestion.correctIndex,
        isCorrect: false,
        pointsGained: 0,
        streak: 0,
      };
      state.quiz.phase = 'REVEAL';
    }
  }

  // 4. Hokm turn timeout
  if (state.gameType === 'hokm' && state.hokm && state.hokm.phase === 'PLAYING' && state.hokmTurnDeadline && now >= state.hokmTurnDeadline) {
    const autoCard = chooseBotCard(state.hokm, state.hokm.turn);
    if (autoCard) {
      changed = true;
      let next = playCard(state.hokm, state.hokm.turn, autoCard.id);
      next = advanceHokmBotsUntilHuman(next, state.players);
      state.hokm = next;
      state.hokmTurnDeadline = next.phase === 'PLAYING' ? now + HOKM_TURN_MS : null;
    }
  }

  if (changed) {
    const finished =
      (state.gameType === 'mafia' && state.mafia?.phase === 'GAME_OVER') ||
      (state.gameType === 'truth_dare' && state.truthDare?.phase === 'FINISHED') ||
      (state.gameType === 'quiz' && state.quiz?.phase === 'FINISHED') ||
      (state.gameType === 'hokm' && state.hokm?.phase === 'MATCH_OVER');
    saveEngineRoom(state, finished ? 'finished' : 'playing');
  }

  return changed;
}

export function loadEngineRoom(roomCode: string): EngineRoomState | null {
  cleanupExpiredEngineRooms();
  const db = getDb();
  const row = db.prepare('SELECT state_json FROM engine_rooms WHERE room_code = ?').get(roomCode.toUpperCase()) as
    | { state_json: string }
    | undefined;
  if (!row) return null;
  const state = JSON.parse(row.state_json) as EngineRoomState;
  reconcileRoomTimers(state);
  return state;
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
 * Security boundary: strictly strips other seats' hands, secret Mafia roles, detective intel,
 * and unrevealed Quiz answers. NEVER falls back to player 0 for non-members.
 */
export function sanitizeEngineStateForUser(state: EngineRoomState, viewerUserId: number | null) {
  const viewerIndex = viewerUserId ? state.players.findIndex((p) => p.userId === viewerUserId && p.status !== 'left') : -1;
  const viewerPlayer = viewerIndex >= 0 ? state.players[viewerIndex] : null;
  const viewerSeat: Seat | null = viewerIndex >= 0 && viewerIndex <= 3 ? (viewerIndex as Seat) : null;

  const safeHokm = state.hokm
    ? {
        ...state.hokm,
        mySeat: viewerSeat,
        turnDeadline: state.hokmTurnDeadline ?? null,
        hands: {
          0:
            viewerSeat === 0
              ? state.hokm.phase === 'CHOOSE_HOKM'
                ? state.hokm.hands[0].slice(0, 5)
                : state.hokm.hands[0]
              : [],
          1:
            viewerSeat === 1
              ? state.hokm.phase === 'CHOOSE_HOKM'
                ? state.hokm.hands[1].slice(0, 5)
                : state.hokm.hands[1]
              : [],
          2:
            viewerSeat === 2
              ? state.hokm.phase === 'CHOOSE_HOKM'
                ? state.hokm.hands[2].slice(0, 5)
                : state.hokm.hands[2]
              : [],
          3:
            viewerSeat === 3
              ? state.hokm.phase === 'CHOOSE_HOKM'
                ? state.hokm.hands[3].slice(0, 5)
                : state.hokm.hands[3]
              : [],
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
        myPlayerId: viewerPlayer?.id ?? null,
        myRole: (() => {
          if (!viewerPlayer) return null;
          const r = state.mafia.roles[viewerPlayer.id];
          if (!r) return null;
          return {
            key: r,
            title: MAFIA_ROLE_META[r].fa,
            team: MAFIA_ROLE_META[r].team,
            description: MAFIA_ROLE_META[r].description,
          };
        })(),
        detectiveIntel: viewerPlayer ? state.mafia.detectiveIntel[viewerPlayer.id] || null : null,
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
    serverNow: Date.now(),
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
  userId: number,
  nextGame: EngineGameType,
  category?: string
): EngineRoomState {
  assertRoomMember(state, userId);
  if (state.hostUserId !== userId) {
    throw new GameEngineError('فقط میزبان اتاق می‌تواند بازی دورهمی را تغییر دهد.', 403);
  }
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
    state.hokm = initHokmState(state.players, 3);
    state.hokmTurnDeadline = state.hokm.phase === 'PLAYING' ? Date.now() + HOKM_TURN_MS : null;
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
    const safeCat =
      category === ADULT_TD_CATEGORY && !checkUserAdultVerified(userId) ? 'دوستانه' : category || 'دوستانه';
    state.truthDare = initTruthDareState(safeCat);
  } else if (nextGame === 'quiz') {
    state.quiz = initQuizState(category || 'همه');
  }
  saveEngineRoom(state, 'playing');
  return state;
}

export function handleHokmChooseTrump(state: EngineRoomState, userId: number, suit: Suit): EngineRoomState {
  assertRoomMember(state, userId);
  if (!state.hokm || state.hokm.phase !== 'CHOOSE_HOKM') {
    throw new GameEngineError('در حال حاضر مرحله انتخاب خال حکم نیست.', 400);
  }
  const viewerIndex = state.players.findIndex((p) => p.userId === userId);
  const hakemPlayer = state.players[state.hokm.hakem];
  const isAuthorized = viewerIndex === state.hokm.hakem || (Boolean(hakemPlayer?.isBot) && state.hostUserId === userId);
  if (!isAuthorized) {
    throw new GameEngineError('فقط حاکم این دست می‌تواند خال حکم را انتخاب کند.', 403);
  }
  state.hokm = advanceHokmBotsUntilHuman(selectHokmSuit(state.hokm, suit), state.players);
  state.hokmTurnDeadline = state.hokm.phase === 'PLAYING' ? Date.now() + HOKM_TURN_MS : null;
  saveEngineRoom(state, 'playing');
  return state;
}

export function handleHokmPlayCard(
  state: EngineRoomState,
  userId: number,
  cardId: string
): { state: EngineRoomState; starsAwarded: number | null } {
  assertRoomMember(state, userId);
  if (!state.hokm || state.hokm.phase !== 'PLAYING') {
    throw new GameEngineError('بازی حکم در مرحله حرکت نیست.', 400);
  }
  const viewerIndex = state.players.findIndex((p) => p.userId === userId);
  if (viewerIndex < 0 || viewerIndex > 3 || state.hokm.turn !== (viewerIndex as Seat)) {
    throw new GameEngineError('هنوز نوبت شما نرسیده است.', 403);
  }
  const seat = viewerIndex as Seat;
  const beforeLen = state.hokm.hands[seat].length;
  let next = playCard(state.hokm, seat, cardId);
  if (next.hands[seat].length === beforeLen) {
    throw new GameEngineError('این کارت طبق قوانین حکم (رعایت خال زمینه) در این نوبت مجاز نیست.', 400);
  }

  next = advanceHokmBotsUntilHuman(next, state.players);
  state.hokm = next;
  state.hokmTurnDeadline = next.phase === 'PLAYING' ? Date.now() + HOKM_TURN_MS : null;

  let starsAwarded: number | null = null;
  if (next.phase === 'MATCH_OVER') {
    const teamIdx = seat % 2;
    const won = next.matchScore[teamIdx] > next.matchScore[1 - teamIdx];
    starsAwarded = awardMatchStarsOnce(
      state,
      userId,
      'hokm',
      next.matchScore[teamIdx] * 120 + next.tricksWon[teamIdx] * 10,
      won
        ? `پیروزی ${next.matchScore[teamIdx]} بر ${next.matchScore[1 - teamIdx]} در حکم`
        : `پایان مسابقه حکم (${next.matchScore[teamIdx]}-${next.matchScore[1 - teamIdx]})`,
      won
    );
    saveEngineRoom(state, 'finished');
  } else {
    saveEngineRoom(state, 'playing');
  }
  return { state, starsAwarded };
}

export function handleHokmNextHand(state: EngineRoomState, userId: number): EngineRoomState {
  assertRoomMember(state, userId);
  if (!state.hokm || state.hokm.phase !== 'HAND_OVER') {
    throw new GameEngineError('دست فعلی هنوز به پایان نرسیده است.', 400);
  }
  const next = startNewHokmHand(
    state.hokm.hakem,
    state.hokm.matchScore,
    state.hokm.roundNumber + 1,
    state.hokm.targetHands
  );
  state.hokm = advanceHokmBotsUntilHuman(next, state.players);
  state.hokmTurnDeadline = state.hokm.phase === 'PLAYING' ? Date.now() + HOKM_TURN_MS : null;
  saveEngineRoom(state, 'playing');
  return state;
}

export function handleMafiaNightAction(
  state: EngineRoomState,
  userId: number,
  targetId?: string
): { state: EngineRoomState; starsAwarded: number | null } {
  const actor = assertRoomMember(state, userId);
  const mafia = state.mafia;
  if (!mafia || mafia.phase !== 'NIGHT_ACTION') {
    throw new GameEngineError('بازی مافیا در فاز شب نیست.', 400);
  }
  const isAlive = mafia.aliveIds.includes(actor.id);
  if (!isAlive && state.hostUserId !== userId) {
    throw new GameEngineError('بازیکن حذف‌شده نمی‌تواند در فاز شب اقدام ثبت کند.', 403);
  }

  const starsAwarded = resolveMafiaNightInternal(state, isAlive ? actor : null, isAlive ? targetId : undefined, false);
  const nextStatus = (mafia.phase as string) === 'GAME_OVER' ? 'finished' : 'playing';
  saveEngineRoom(state, nextStatus);
  return { state, starsAwarded };
}

export function handleMafiaStartVote(state: EngineRoomState, userId: number): EngineRoomState {
  const actor = assertRoomMember(state, userId);
  if (!state.mafia || state.mafia.phase !== 'DAY_DISCUSSION') {
    throw new GameEngineError('فاز گفت‌وگوی روز فعال نیست.', 400);
  }
  if (!state.mafia.aliveIds.includes(actor.id) && state.hostUserId !== userId) {
    throw new GameEngineError('فقط بازیکنان زنده یا میزبان می‌توانند رأی‌گیری را آغاز کنند.', 403);
  }
  state.mafia.phase = 'VOTING';
  state.mafia.votes = {};
  state.mafia.phaseEndsAt = Date.now() + MAFIA_VOTE_MS;
  state.mafia.log.unshift({
    at: nowTimeLabel(),
    phase: 'VOTING',
    text: `رأی‌گیری روز ${state.mafia.dayNumber} آغاز شد.`,
  });
  saveEngineRoom(state, 'playing');
  return state;
}

export function handleMafiaVote(
  state: EngineRoomState,
  userId: number,
  targetId: string
): { state: EngineRoomState; starsAwarded: number | null } {
  const actor = assertRoomMember(state, userId);
  const mafia = state.mafia;
  if (!mafia || mafia.phase !== 'VOTING') {
    throw new GameEngineError('فاز رأی‌گیری مافیا فعال نیست.', 400);
  }
  const isAlive = mafia.aliveIds.includes(actor.id);
  if (!isAlive && state.hostUserId !== userId) {
    throw new GameEngineError('بازیکن حذف‌شده حق رأی ندارد.', 403);
  }
  if (isAlive && !mafia.aliveIds.includes(targetId)) {
    throw new GameEngineError('هدف انتخاب‌شده در بازی زنده نیست.', 400);
  }

  const starsAwarded = resolveMafiaVoteInternal(state, isAlive ? actor : null, isAlive ? targetId : undefined, false);
  const nextStatus = (mafia.phase as string) === 'GAME_OVER' ? 'finished' : 'playing';
  saveEngineRoom(state, nextStatus);
  return { state, starsAwarded };
}

export function handleTruthDareSpin(state: EngineRoomState, userId: number, category?: string): EngineRoomState {
  assertRoomMember(state, userId);
  const td = state.truthDare;
  if (!td) throw new GameEngineError('وضعیت اتاق جرئت و حقیقت یافت نشد.', 400);
  if (td.phase !== 'READY_TO_SPIN' && td.phase !== 'LOBBY') {
    throw new GameEngineError('در این مرحله ابتدا باید نوبت فعلی تکمیل شود.', 400);
  }

  if (category) {
    if (category === ADULT_TD_CATEGORY && !checkUserAdultVerified(userId)) {
      throw new GameEngineError('بخش بزرگسالان ۱۸+ فقط پس از تکمیل احراز سن و رضایت در پروفایل باز می‌شود.', 403);
    }
    td.category = category;
  }

  const activePlayers = state.players.filter((p) => p.status !== 'left');
  if (activePlayers.length < 2) {
    throw new GameEngineError('برای چرخاندن بطری حداقل ۲ بازیکن لازم است.', 400);
  }

  const chosenIdx = crypto.randomInt(0, activePlayers.length);
  const chosenPlayer = activePlayers[chosenIdx];
  const seatAngleDeg = (360 / activePlayers.length) * chosenIdx;
  const extraFullSpins = (4 + crypto.randomInt(0, 4)) * 360;
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
  td.turnDeadline = Date.now() + TD_CHOOSE_MS;

  saveEngineRoom(state, 'playing');
  return state;
}

export function handleTruthDareChooseMode(
  state: EngineRoomState,
  userId: number,
  mode: 'truth' | 'dare',
  category?: string
): EngineRoomState {
  assertRoomMember(state, userId);
  const td = state.truthDare;
  if (!td || td.phase !== 'CHOOSE_MODE') {
    throw new GameEngineError('ابتدا باید بطری بچرخد تا بازیکن انتخاب شود.', 400);
  }

  const targetPlayer = state.players.find((p) => p.id === td.targetPlayerId);
  if (!targetPlayer) {
    throw new GameEngineError('بازیکن نوبت فعلی یافت نشد.', 400);
  }
  const canAct = targetPlayer.userId === userId || (targetPlayer.isBot && state.hostUserId === userId);
  if (!canAct) {
    throw new GameEngineError(`الان نوبت «${targetPlayer.name}» است و فقط او می‌تواند حقیقت یا جرئت را انتخاب کند.`, 403);
  }

  const cat = category || td.category || 'همه';
  const isAdultVerified = checkUserAdultVerified(userId);
  if (cat === ADULT_TD_CATEGORY && !isAdultVerified) {
    throw new GameEngineError('دسته بزرگسالان ۱۸+ قفل است و نیاز به احراز چندلایه ۱۸+ در پروفایل دارد.', 403);
  }
  td.category = cat;

  const db = getDb();
  let rows: { id: number; mode: 'truth' | 'dare'; category: string; text: string; is_adult: number }[];

  // STRICT truth vs dare separation + strict adult isolation
  if (cat === ADULT_TD_CATEGORY) {
    rows = db
      .prepare('SELECT id, mode, category, text, is_adult FROM truth_dare_prompts WHERE mode = ? AND category = ? AND is_adult = 1')
      .all(mode, ADULT_TD_CATEGORY) as typeof rows;
  } else if (cat !== 'همه') {
    rows = db
      .prepare('SELECT id, mode, category, text, is_adult FROM truth_dare_prompts WHERE mode = ? AND category = ? AND is_adult = 0')
      .all(mode, cat) as typeof rows;
  } else {
    rows = db
      .prepare('SELECT id, mode, category, text, is_adult FROM truth_dare_prompts WHERE mode = ? AND is_adult = 0')
      .all(mode) as typeof rows;
  }

  // Fallback ONLY within same mode and strictly safe (is_adult = 0) if a custom category has 0 rows
  if (rows.length === 0 && cat !== ADULT_TD_CATEGORY) {
    rows = db
      .prepare('SELECT id, mode, category, text, is_adult FROM truth_dare_prompts WHERE mode = ? AND is_adult = 0')
      .all(mode) as typeof rows;
  }

  const unused = rows.filter((r) => !td.usedPromptIds.includes(r.id));
  const pool = unused.length > 0 ? unused : rows;
  if (pool.length === 0) {
    throw new GameEngineError('موردی برای این حالت یافت نشد.', 404);
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
  td.turnDeadline = Date.now() + TD_PROMPT_MS;

  saveEngineRoom(state, 'playing');
  return state;
}

export function handleTruthDareResolveTurn(
  state: EngineRoomState,
  userId: number,
  outcome: 'completed' | 'skipped'
): { state: EngineRoomState; starsAwarded: number | null } {
  assertRoomMember(state, userId);
  const td = state.truthDare;
  if (!td || td.phase !== 'SHOW_PROMPT') {
    throw new GameEngineError('در این مرحله کارتی برای ثبت نتیجه فعال نیست.', 400);
  }

  const targetPlayer = state.players.find((p) => p.id === td.targetPlayerId);
  if (targetPlayer) {
    const canResolve =
      targetPlayer.userId === userId || (targetPlayer.isBot && state.hostUserId === userId) || state.hostUserId === userId;
    if (!canResolve) {
      throw new GameEngineError('فقط بازیکن نوبت فعلی یا میزبان می‌تواند نتیجه این نوبت را ثبت کند.', 403);
    }
  }

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
      `تکمیل ${td.maxRounds} دور جرئت و حقیقت`,
      true
    );
    saveEngineRoom(state, 'finished');
  } else {
    td.phase = 'READY_TO_SPIN';
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
  const me = assertRoomMember(state, userId);
  const qz = state.quiz;
  if (!qz || qz.phase !== 'QUESTION' || !qz.currentQuestion) {
    throw new GameEngineError('سؤال فعالی برای پاسخ‌گویی وجود ندارد.', 400);
  }

  const elapsedSec = Math.max(0, (Date.now() - qz.questionStartedAt) / 1000);
  const remainingSec = Math.max(0, Math.round(qz.questionDurationSec - elapsedSec));
  const isCorrect = selectedIndex === qz.currentQuestion.correctIndex;

  let pointsGained = 0;
  if (isCorrect) {
    qz.streak += 1;
    qz.correctCount += 1;
    pointsGained = 100 + remainingSec * 12 + (qz.streak > 1 ? 25 : 0);
    me.score += pointsGained;
  } else {
    qz.streak = 0;
  }

  for (const r of qz.rivals) {
    if (crypto.randomInt(0, 100) < 68) {
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
  const me = assertRoomMember(state, userId);
  const qz = state.quiz;
  if (!qz || qz.phase !== 'REVEAL') {
    throw new GameEngineError('ابتدا باید به سؤال فعلی پاسخ دهید.', 400);
  }

  const nextIdx = qz.currentIndex + 1;
  if (nextIdx >= qz.questionIds.length) {
    qz.phase = 'FINISHED';
    qz.currentQuestion = null;
    const myScore = me.score;
    const topRival = Math.max(...qz.rivals.map((r) => r.score), 0);
    const won = myScore >= topRival && qz.correctCount >= 3;
    const starsAwarded = awardMatchStarsOnce(
      state,
      userId,
      'quiz',
      myScore,
      `پاسخ صحیح ${qz.correctCount} از ${qz.totalQuestions} در کوییز`,
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
