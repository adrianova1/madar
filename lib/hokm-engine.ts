export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Seat = 0 | 1 | 2 | 3; // 0 = You (South), 1 = Opponent East, 2 = Partner North, 3 = Opponent West

export interface PlayingCard {
  id: string;
  suit: Suit;
  rank: number; // 2..14 (11=J, 12=Q, 13=K, 14=A)
}

export interface TrickPlay {
  seat: Seat;
  card: PlayingCard;
}

export type HokmPhase = 'IDLE' | 'CHOOSE_HOKM' | 'PLAYING' | 'HAND_OVER' | 'MATCH_OVER';

export interface HokmState {
  phase: HokmPhase;
  hands: Record<Seat, PlayingCard[]>;
  hakem: Seat;
  hokm: Suit | null;
  turn: Seat;
  currentTrick: TrickPlay[];
  leadSuit: Suit | null;
  tricksWon: [number, number]; // [Team A (0&2), Team B (1&3)]
  matchScore: [number, number]; // First to 7 hands wins
  lastTrickWinner: Seat | null;
  lastEvent: string;
  roundNumber: number;
  targetHands: number;
}

export const SUIT_META: Record<Suit, { symbol: string; fa: string; isRed: boolean }> = {
  spades: { symbol: '♠', fa: 'پیک', isRed: false },
  hearts: { symbol: '♥', fa: 'دل', isRed: true },
  diamonds: { symbol: '♦', fa: 'خشت', isRed: true },
  clubs: { symbol: '♣', fa: 'گشنیز', isRed: false },
};

export const SEAT_LABELS: Record<Seat, string> = {
  0: 'تو (تیم ما)',
  1: 'حریف راست',
  2: 'یار روبه‌رو (تیم ما)',
  3: 'حریف چپ',
};

export function rankLabel(rank: number): string {
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

function createShuffledDeck(): PlayingCard[] {
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
  const deck: PlayingCard[] = [];
  for (const suit of suits) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ id: `${suit}_${rank}`, suit, rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function sortHand(cards: PlayingCard[]): PlayingCard[] {
  const order: Record<Suit, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
  return [...cards].sort((a, b) => {
    if (order[a.suit] !== order[b.suit]) return order[a.suit] - order[b.suit];
    return b.rank - a.rank;
  });
}

export function teamOf(seat: Seat): 0 | 1 {
  return seat === 0 || seat === 2 ? 0 : 1;
}

export function startNewHokmHand(
  hakem: Seat = 0,
  matchScore: [number, number] = [0, 0],
  roundNumber = 1,
  targetHands = 7
): HokmState {
  const deck = createShuffledDeck();
  const hands: Record<Seat, PlayingCard[]> = {
    0: sortHand(deck.slice(0, 13)),
    1: sortHand(deck.slice(13, 26)),
    2: sortHand(deck.slice(26, 39)),
    3: sortHand(deck.slice(39, 52)),
  };

  if (hakem === 0) {
    return {
      phase: 'CHOOSE_HOKM',
      hands,
      hakem,
      hokm: null,
      turn: 0,
      currentTrick: [],
      leadSuit: null,
      tricksWon: [0, 0],
      matchScore,
      lastTrickWinner: null,
      lastEvent: 'تو حاکم این دست هستی! با دیدن ۵ کارت اول، حکم را انتخاب کن.',
      roundNumber,
      targetHands,
    };
  }

  // Bot Hakem picks strongest suit from first 5 cards
  const firstFive = hands[hakem].slice(0, 5);
  const suitScores: Record<Suit, number> = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  for (const c of firstFive) {
    suitScores[c.suit] += c.rank >= 11 ? 3 : 1.5;
  }
  const chosenHokm = (Object.entries(suitScores).sort((a, b) => b[1] - a[1])[0][0]) as Suit;

  return {
    phase: 'PLAYING',
    hands,
    hakem,
    hokm: chosenHokm,
    turn: hakem,
    currentTrick: [],
    leadSuit: null,
    tricksWon: [0, 0],
    matchScore,
    lastTrickWinner: null,
    lastEvent: `${SEAT_LABELS[hakem]} حاکم شد و خال «${SUIT_META[chosenHokm].fa}» را حکم کرد.`,
    roundNumber,
    targetHands,
  };
}

export function selectHokmSuit(state: HokmState, suit: Suit): HokmState {
  if (state.phase !== 'CHOOSE_HOKM' || state.hakem !== 0) return state;
  return {
    ...state,
    phase: 'PLAYING',
    hokm: suit,
    turn: 0,
    lastEvent: `خال ${SUIT_META[suit].fa} (${SUIT_META[suit].symbol}) حکم شد. نوبت آغاز بازی با توست.`,
  };
}

export function getLegalCards(state: HokmState, seat: Seat): PlayingCard[] {
  const hand = state.hands[seat];
  if (!state.leadSuit) return hand;
  const matching = hand.filter((c) => c.suit === state.leadSuit);
  return matching.length > 0 ? matching : hand;
}

export function isCardPlayable(state: HokmState, seat: Seat, cardId: string): boolean {
  if (state.phase !== 'PLAYING' || state.turn !== seat) return false;
  return getLegalCards(state, seat).some((c) => c.id === cardId);
}

function evaluateTrickWinner(trick: TrickPlay[], leadSuit: Suit, hokm: Suit): Seat {
  let winning = trick[0];
  for (let i = 1; i < trick.length; i++) {
    const candidate = trick[i];
    const winIsTrump = winning.card.suit === hokm;
    const candIsTrump = candidate.card.suit === hokm;

    if (candIsTrump && !winIsTrump) {
      winning = candidate;
    } else if (candIsTrump && winIsTrump && candidate.card.rank > winning.card.rank) {
      winning = candidate;
    } else if (!candIsTrump && !winIsTrump && candidate.card.suit === leadSuit && candidate.card.rank > winning.card.rank) {
      winning = candidate;
    }
  }
  return winning.seat;
}

export function playCard(state: HokmState, seat: Seat, cardId: string): HokmState {
  if (!isCardPlayable(state, seat, cardId) || !state.hokm) return state;

  const hand = state.hands[seat];
  const card = hand.find((c) => c.id === cardId);
  if (!card) return state;

  const nextHands: Record<Seat, PlayingCard[]> = {
    ...state.hands,
    [seat]: hand.filter((c) => c.id !== cardId),
  };

  const leadSuit = state.currentTrick.length === 0 ? card.suit : state.leadSuit!;
  const nextTrick = [...state.currentTrick, { seat, card }];

  if (nextTrick.length < 4) {
    const nextTurn = ((seat + 1) % 4) as Seat;
    return {
      ...state,
      hands: nextHands,
      currentTrick: nextTrick,
      leadSuit,
      turn: nextTurn,
      lastEvent: `${SEAT_LABELS[seat]} کارت ${rankLabel(card.rank)}${SUIT_META[card.suit].symbol} را بازی کرد.`,
    };
  }

  // Resolve 4-card trick
  const winnerSeat = evaluateTrickWinner(nextTrick, leadSuit, state.hokm);
  const winningTeam = teamOf(winnerSeat);
  const nextTricksWon: [number, number] = [...state.tricksWon] as [number, number];
  nextTricksWon[winningTeam] += 1;

  // Check if hand ended (first team to 7 tricks)
  if (nextTricksWon[0] >= 7 || nextTricksWon[1] >= 7) {
    const handWinnerTeam: 0 | 1 = nextTricksWon[0] >= 7 ? 0 : 1;
    const loserTricks = handWinnerTeam === 0 ? nextTricksWon[1] : nextTricksWon[0];
    const hakemTeam = teamOf(state.hakem);
    // Kot = 2 points if loser took 0 tricks (3 if Hakem was Kot)
    const points = loserTricks === 0 ? (handWinnerTeam !== hakemTeam ? 3 : 2) : 1;

    const nextMatchScore: [number, number] = [...state.matchScore] as [number, number];
    nextMatchScore[handWinnerTeam] += points;

    const nextHakem: Seat = handWinnerTeam === hakemTeam ? state.hakem : (((state.hakem + 1) % 4) as Seat);
    const matchEnded = nextMatchScore[0] >= state.targetHands || nextMatchScore[1] >= state.targetHands;

    return {
      ...state,
      phase: matchEnded ? 'MATCH_OVER' : 'HAND_OVER',
      hands: nextHands,
      currentTrick: [],
      leadSuit: null,
      tricksWon: nextTricksWon,
      matchScore: nextMatchScore,
      hakem: nextHakem,
      lastTrickWinner: winnerSeat,
      lastEvent:
        handWinnerTeam === 0
          ? `تیم شما این دست را ${points > 1 ? `با کُت (${points} امتیاز)` : 'برد'}!`
          : `تیم حریف این دست را ${points > 1 ? `با کُت (${points} امتیاز)` : 'برد'}.`,
    };
  }

  return {
    ...state,
    hands: nextHands,
    currentTrick: [],
    leadSuit: null,
    tricksWon: nextTricksWon,
    turn: winnerSeat,
    lastTrickWinner: winnerSeat,
    lastEvent: `${SEAT_LABELS[winnerSeat]} این دور را جمع کرد.`,
  };
}

export function chooseBotCard(state: HokmState, seat: Seat): PlayingCard {
  const legal = getLegalCards(state, seat);
  const hokm = state.hokm!;

  // Leading a trick: play highest non-trump or strongest trump
  if (state.currentTrick.length === 0) {
    const highNonTrump = legal.filter((c) => c.suit !== hokm).sort((a, b) => b.rank - a.rank);
    if (highNonTrump.length > 0 && highNonTrump[0].rank >= 13) return highNonTrump[0];
    const sorted = [...legal].sort((a, b) => b.rank - a.rank);
    return sorted[0];
  }

  const currentWinner = evaluateTrickWinner(state.currentTrick, state.leadSuit!, hokm);
  const partnerWinning = teamOf(currentWinner) === teamOf(seat);

  if (partnerWinning) {
    // Discard lowest non-trump card
    const nonTrumps = legal.filter((c) => c.suit !== hokm).sort((a, b) => a.rank - b.rank);
    return nonTrumps[0] ?? [...legal].sort((a, b) => a.rank - b.rank)[0];
  }

  // Try to beat current trick with minimal winning card
  const winningCandidates = legal.filter((cand) => {
    const simulated = [...state.currentTrick, { seat, card: cand }];
    return evaluateTrickWinner(simulated, state.leadSuit!, hokm) === seat;
  });

  if (winningCandidates.length > 0) {
    return winningCandidates.sort((a, b) => {
      const aTrump = a.suit === hokm ? 1 : 0;
      const bTrump = b.suit === hokm ? 1 : 0;
      if (aTrump !== bTrump) return aTrump - bTrump;
      return a.rank - b.rank;
    })[0];
  }

  // Otherwise shed lowest non-trump card
  const nonTrumps = legal.filter((c) => c.suit !== hokm).sort((a, b) => a.rank - b.rank);
  return nonTrumps[0] ?? [...legal].sort((a, b) => a.rank - b.rank)[0];
}
