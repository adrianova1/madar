export type MafiaRole = 'citizen' | 'mafia' | 'doctor' | 'detective' | 'sniper' | 'professional';

export type MafiaPhase =
  | 'LOBBY'
  | 'ROLE_REVEAL'
  | 'NIGHT_MAFIA'
  | 'NIGHT_DOCTOR'
  | 'NIGHT_DETECTIVE'
  | 'DAY_DISCUSSION'
  | 'VOTING'
  | 'GAME_OVER';

export interface MafiaPlayer {
  id: string;
  name: string;
  role: MafiaRole;
  alive: boolean;
}

export interface MafiaGameState {
  roomCode: string;
  phase: MafiaPhase;
  dayNumber: number;
  scenarioName: string;
  players: MafiaPlayer[];
  revealIndex: number;
  nightActions: {
    mafiaTargetId: string | null;
    doctorTargetId: string | null;
    detectiveTargetId: string | null;
    detectiveResult: string | null;
  };
  votes: Record<string, string>; // voterId -> targetId
  winner: 'citizens' | 'mafia' | null;
  log: string[];
}

export const MAFIA_ROLE_META: Record<
  MafiaRole,
  { fa: string; team: 'citizens' | 'mafia'; description: string }
> = {
  citizen: { fa: 'شهروند ساده', team: 'citizens', description: 'در روز با تحلیل و رأی‌گیری مافیا را شناسایی می‌کند.' },
  mafia: { fa: 'مافیا', team: 'mafia', description: 'در شب با هم‌تیمی‌ها هدف حذف را انتخاب می‌کند.' },
  doctor: { fa: 'دکتر', team: 'citizens', description: 'هر شب یک نفر را از شلیک مافیا نجات می‌دهد.' },
  detective: { fa: 'کارآگاه', team: 'citizens', description: 'هر شب استعلام یکی از بازیکنان را از گرداننده می‌گیرد.' },
  sniper: { fa: 'تک‌تیرانداز', team: 'citizens', description: 'قدرت شلیک دقیق در شب به مظنون اصلی مافیا را دارد.' },
  professional: { fa: 'حرفه‌ای', team: 'citizens', description: 'در صورت اشتباه در هدف‌گیری شهروند، خودش از بازی خارج می‌شود.' },
};

export function createMafiaGame(playerNames: string[], scenario: 'classic' | 'tactical'): MafiaGameState {
  const cleanNames = playerNames.map((n) => n.trim()).filter(Boolean);
  const count = Math.max(6, Math.min(12, cleanNames.length));
  const names = cleanNames.slice(0, count);

  const roles: MafiaRole[] = [];
  const mafiaCount = count >= 9 ? 3 : 2;
  for (let i = 0; i < mafiaCount; i++) roles.push('mafia');
  roles.push('doctor');
  roles.push('detective');
  if (scenario === 'tactical' && count >= 7) {
    roles.push('sniper');
  }
  while (roles.length < count) roles.push('citizen');

  // Fisher-Yates shuffle
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  const players: MafiaPlayer[] = names.map((name, idx) => ({
    id: `p_${idx + 1}`,
    name,
    role: roles[idx],
    alive: true,
  }));

  const roomCode = `MDR-${Math.floor(1000 + Math.random() * 9000)}`;
  return {
    roomCode,
    phase: 'ROLE_REVEAL',
    dayNumber: 1,
    scenarioName: scenario === 'tactical' ? 'سناریوی تاکتیکی (تک‌تیرانداز)' : 'سناریوی کلاسیک مدار',
    players,
    revealIndex: 0,
    nightActions: {
      mafiaTargetId: null,
      doctorTargetId: null,
      detectiveTargetId: null,
      detectiveResult: null,
    },
    votes: {},
    winner: null,
    log: [`اتاق مافیا (${roomCode}) با ${players.length} بازیکن ساخته شد. مرحله نمایش محرمانه نقش‌ها آغاز شد.`],
  };
}

function checkWinner(players: MafiaPlayer[]): 'citizens' | 'mafia' | null {
  const aliveMafia = players.filter((p) => p.alive && p.role === 'mafia').length;
  const aliveCitizens = players.filter((p) => p.alive && p.role !== 'mafia').length;
  if (aliveMafia === 0) return 'citizens';
  if (aliveMafia >= aliveCitizens) return 'mafia';
  return null;
}

export function advanceRoleReveal(state: MafiaGameState): MafiaGameState {
  if (state.phase !== 'ROLE_REVEAL') return state;
  if (state.revealIndex + 1 < state.players.length) {
    return { ...state, revealIndex: state.revealIndex + 1 };
  }
  return {
    ...state,
    phase: 'NIGHT_MAFIA',
    log: [`شب ${state.dayNumber} آغاز شد. نوبت تصمیم‌گیری تیم مافیا.`, ...state.log],
  };
}

export function submitMafiaShot(state: MafiaGameState, targetId: string): MafiaGameState {
  if (state.phase !== 'NIGHT_MAFIA') return state;
  const target = state.players.find((p) => p.id === targetId && p.alive);
  if (!target) return state;

  const hasAliveDoctor = state.players.some((p) => p.alive && p.role === 'doctor');
  const hasAliveDetective = state.players.some((p) => p.alive && p.role === 'detective');

  const nextState: MafiaGameState = {
    ...state,
    nightActions: { ...state.nightActions, mafiaTargetId: targetId },
  };

  if (hasAliveDoctor) {
    return { ...nextState, phase: 'NIGHT_DOCTOR' };
  }
  if (hasAliveDetective) {
    return { ...nextState, phase: 'NIGHT_DETECTIVE' };
  }
  return resolveNight(nextState);
}

export function submitDoctorSave(state: MafiaGameState, targetId: string): MafiaGameState {
  if (state.phase !== 'NIGHT_DOCTOR') return state;
  const target = state.players.find((p) => p.id === targetId && p.alive);
  if (!target) return state;

  const nextState: MafiaGameState = {
    ...state,
    nightActions: { ...state.nightActions, doctorTargetId: targetId },
  };

  const hasAliveDetective = state.players.some((p) => p.alive && p.role === 'detective');
  if (hasAliveDetective) {
    return { ...nextState, phase: 'NIGHT_DETECTIVE' };
  }
  return resolveNight(nextState);
}

export function submitDetectiveCheck(state: MafiaGameState, targetId: string): MafiaGameState {
  if (state.phase !== 'NIGHT_DETECTIVE') return state;
  const target = state.players.find((p) => p.id === targetId && p.alive);
  if (!target) return state;

  const isMafia = target.role === 'mafia';
  const resultText = `استعلام کارآگاه برای ${target.name}: ${isMafia ? 'مافیا است!' : 'عضو تیم شهروند است.'}`;

  return resolveNight({
    ...state,
    nightActions: {
      ...state.nightActions,
      detectiveTargetId: targetId,
      detectiveResult: resultText,
    },
  });
}

function resolveNight(state: MafiaGameState): MafiaGameState {
  const { mafiaTargetId, doctorTargetId } = state.nightActions;
  let updatedPlayers = state.players;
  let morningMsg = `صبح روز ${state.dayNumber}: شهر بدون کشته بیدار شد (دکتر هدف را نجات داد).`;

  if (mafiaTargetId && mafiaTargetId !== doctorTargetId) {
    const victim = state.players.find((p) => p.id === mafiaTargetId);
    updatedPlayers = state.players.map((p) => (p.id === mafiaTargetId ? { ...p, alive: false } : p));
    morningMsg = `صبح روز ${state.dayNumber}: متأسفانه «${victim?.name}» در شب حذف شد.`;
  }

  const winner = checkWinner(updatedPlayers);
  return {
    ...state,
    players: updatedPlayers,
    phase: winner ? 'GAME_OVER' : 'DAY_DISCUSSION',
    winner,
    log: [morningMsg, ...state.log],
  };
}

export function startVotingPhase(state: MafiaGameState): MafiaGameState {
  if (state.phase !== 'DAY_DISCUSSION') return state;
  return {
    ...state,
    phase: 'VOTING',
    votes: {},
    log: [`رأی‌گیری روز ${state.dayNumber} آغاز شد.`, ...state.log],
  };
}

export function eliminateByVote(state: MafiaGameState, targetId: string | null): MafiaGameState {
  if (state.phase !== 'VOTING') return state;

  let updatedPlayers = state.players;
  let msg = `در رأی‌گیری روز ${state.dayNumber} هیچ‌کس حذف نشد.`;

  if (targetId) {
    const target = state.players.find((p) => p.id === targetId && p.alive);
    if (target) {
      updatedPlayers = state.players.map((p) => (p.id === targetId ? { ...p, alive: false } : p));
      msg = `با رأی اکثریت شهر، «${target.name}» از بازی خارج شد.`;
    }
  }

  const winner = checkWinner(updatedPlayers);
  return {
    ...state,
    players: updatedPlayers,
    dayNumber: winner ? state.dayNumber : state.dayNumber + 1,
    phase: winner ? 'GAME_OVER' : 'NIGHT_MAFIA',
    winner,
    nightActions: {
      mafiaTargetId: null,
      doctorTargetId: null,
      detectiveTargetId: null,
      detectiveResult: null,
    },
    votes: {},
    log: [msg, ...state.log],
  };
}
