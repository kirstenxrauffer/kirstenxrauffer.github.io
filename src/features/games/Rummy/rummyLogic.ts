import type { Card, Rank } from '../types';

// ─── Gin Rummy pure logic ─────────────────────────────────────────────────────
//
// Standard single-round Gin Rummy against navi. Deals 10 cards each, one to
// the discard pile, rest to the stock. Players alternate turns:
//   1. Draw — from stock OR top of discard.
//   2. Discard — one card back to the discard pile.
// Players may KNOCK (lay down melds) on discard if deadwood ≤ 10; GIN when
// deadwood = 0. We do NOT implement lay-offs onto the opponent's melds here
// to keep the end-of-round UI manageable.
//
// Everything here is pure — no React, no DOM. Good for unit tests.

export type Side = 'player' | 'navi';

export type TurnPhase = 'draw' | 'discard' | 'gameover';

export type DrawSource = 'stock' | 'discard';

/**
 * Meld = set (3+ same rank) OR run (3+ same-suit consecutive cards).
 * Stored as the literal card array for easy point-summing.
 */
export type Meld = Card[];

export type Melding = {
  melds: Meld[];
  deadwood: Card[];
  deadwoodValue: number;
};

export type RummyState = {
  turn: Side;
  phase: TurnPhase;
  player: Card[];
  navi: Card[];
  stock: Card[];
  discard: Card[]; // last element is the top
  // Knock info populated when the round ends.
  outcome: null | {
    knocker: Side;
    wasGin: boolean;
    playerMelding: Melding;
    naviMelding: Melding;
    winner: Side | 'draw';
    points: number; // winner's point gain
  };
};

// ─── Card helpers ─────────────────────────────────────────────────────────────

/**
 * Gin Rummy uses LOW aces (A-2-3 is a run; Q-K-A is not). Value is used for
 * run comparison only — points are a separate concept (see ginPoints).
 */
export function ginRankOrder(rank: Rank): number {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return parseInt(rank, 10);
}

/** Deadwood point value — face cards worth 10, ace worth 1, numerics = face. */
export function ginPoints(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return parseInt(card.rank, 10);
}

// ─── Dealing ──────────────────────────────────────────────────────────────────

export function dealInitial(deck: Card[]): RummyState {
  // Deck comes in shuffled. First 10 to player, next 10 to navi, 1 to discard,
  // rest to stock.
  const player = deck.slice(0, 10);
  const navi   = deck.slice(10, 20);
  const discard = [deck[20]];
  const stock = deck.slice(21);
  return {
    turn: 'player',
    phase: 'draw',
    player,
    navi,
    stock,
    discard,
    outcome: null,
  };
}

// ─── Meld detection ───────────────────────────────────────────────────────────

/**
 * Enumerate every valid meld present in a hand. Returns the literal card
 * arrays — downstream code picks a disjoint subset via set-packing search.
 *
 * Sets: 3 or 4 cards of the same rank (every 3-subset of a 4-rank group is
 * considered, so the packer can choose "3 kings + discard the fourth").
 *
 * Runs: 3+ consecutive cards in one suit using low-ace ordering.
 * All 3+ length consecutive subsequences are returned.
 */
export function findAllMelds(hand: Card[]): Meld[] {
  const melds: Meld[] = [];

  // Sets by rank.
  const byRank = new Map<Rank, Card[]>();
  for (const c of hand) {
    const arr = byRank.get(c.rank) ?? [];
    arr.push(c);
    byRank.set(c.rank, arr);
  }
  for (const arr of byRank.values()) {
    if (arr.length === 3) {
      melds.push([...arr]);
    } else if (arr.length === 4) {
      melds.push([...arr]);
      // 4 three-card subsets.
      for (let i = 0; i < 4; i++) {
        melds.push(arr.filter((_, j) => j !== i));
      }
    }
  }

  // Runs by suit.
  const bySuit = new Map<string, Card[]>();
  for (const c of hand) {
    const arr = bySuit.get(c.suit) ?? [];
    arr.push(c);
    bySuit.set(c.suit, arr);
  }
  for (const arr of bySuit.values()) {
    // Dedupe by rank — a hand can't have duplicate (rank,suit); cards are unique.
    const sorted = [...arr].sort((a, b) => ginRankOrder(a.rank) - ginRankOrder(b.rank));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 2; j < sorted.length; j++) {
        let ok = true;
        for (let k = i; k < j; k++) {
          if (ginRankOrder(sorted[k + 1].rank) !== ginRankOrder(sorted[k].rank) + 1) {
            ok = false;
            break;
          }
        }
        if (ok) melds.push(sorted.slice(i, j + 1));
      }
    }
  }

  return melds;
}

/**
 * Find the meld decomposition that minimises deadwood value. Branch-and-bound
 * over disjoint meld selections. For 10- or 11-card hands the search space is
 * small (tens of melds at most); this returns in microseconds.
 */
export function bestMelding(hand: Card[]): Melding {
  const allMelds = findAllMelds(hand);
  // Precompute point value of each meld for pruning.
  const meldValue = allMelds.map((m) => m.reduce((s, c) => s + ginPoints(c), 0));

  let bestValue = 0;
  let bestSelection: number[] = []; // indices into allMelds

  const used = new Set<number>();
  const cur: number[] = [];

  function backtrack(startIdx: number, value: number) {
    if (value > bestValue) {
      bestValue = value;
      bestSelection = cur.slice();
    }
    for (let i = startIdx; i < allMelds.length; i++) {
      const meld = allMelds[i];
      let clash = false;
      for (const c of meld) {
        if (used.has(c.id)) { clash = true; break; }
      }
      if (clash) continue;
      for (const c of meld) used.add(c.id);
      cur.push(i);
      backtrack(i + 1, value + meldValue[i]);
      cur.pop();
      for (const c of meld) used.delete(c.id);
    }
  }

  backtrack(0, 0);

  const selectedMelds = bestSelection.map((i) => allMelds[i]);
  const coveredIds = new Set(selectedMelds.flat().map((c) => c.id));
  const deadwood = hand.filter((c) => !coveredIds.has(c.id));
  const deadwoodValue = deadwood.reduce((s, c) => s + ginPoints(c), 0);
  return { melds: selectedMelds, deadwood, deadwoodValue };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/** Non-mutating: returns a new state with `side` having drawn from `source`. */
export function draw(state: RummyState, side: Side, source: DrawSource): RummyState {
  if (state.phase !== 'draw') throw new Error('cannot draw out of draw phase');
  if (state.turn !== side) throw new Error('not this side\'s turn');

  if (source === 'stock') {
    if (state.stock.length === 0) {
      // Exhausted stock — round ends as a draw. Caller decides scoring.
      return { ...state, phase: 'gameover', outcome: makeDrawOutcome(state) };
    }
    const top = state.stock[0];
    const stock = state.stock.slice(1);
    if (side === 'player') return { ...state, stock, player: [...state.player, top], phase: 'discard' };
    return { ...state, stock, navi: [...state.navi, top], phase: 'discard' };
  }
  // Source: discard
  if (state.discard.length === 0) throw new Error('discard pile empty');
  const top = state.discard[state.discard.length - 1];
  const discard = state.discard.slice(0, -1);
  if (side === 'player') return { ...state, discard, player: [...state.player, top], phase: 'discard' };
  return { ...state, discard, navi: [...state.navi, top], phase: 'discard' };
}

/**
 * Discard the card with the given id from `side`'s hand. Advances the turn
 * to the opposite side and sets phase back to 'draw'. Throws if the card
 * isn't in the hand or the side isn't in discard phase.
 */
export function discard(state: RummyState, side: Side, cardId: number): RummyState {
  if (state.phase !== 'discard') throw new Error('cannot discard out of discard phase');
  if (state.turn !== side) throw new Error('not this side\'s turn');

  const hand = side === 'player' ? state.player : state.navi;
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error('card not in hand');
  const card = hand[idx];
  const newHand = hand.filter((_, i) => i !== idx);
  const newDiscard = [...state.discard, card];
  const nextSide: Side = side === 'player' ? 'navi' : 'player';

  if (side === 'player') {
    return { ...state, player: newHand, discard: newDiscard, turn: nextSide, phase: 'draw' };
  }
  return { ...state, navi: newHand, discard: newDiscard, turn: nextSide, phase: 'draw' };
}

/**
 * Knock: `side` discards `cardId`, then lays down melds. Valid only when the
 * resulting hand's deadwood is ≤ 10. Gin is a special knock with deadwood = 0.
 * Returns the state with outcome populated.
 */
export function knock(state: RummyState, side: Side, cardId: number): RummyState {
  if (state.phase !== 'discard') throw new Error('can only knock on your discard');
  if (state.turn !== side) throw new Error('not this side\'s turn');

  const hand = side === 'player' ? state.player : state.navi;
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error('knock card not in hand');
  const card = hand[idx];
  const remaining = hand.filter((_, i) => i !== idx);
  const knockerMelding = bestMelding(remaining);
  if (knockerMelding.deadwoodValue > 10) {
    throw new Error('illegal knock — deadwood > 10');
  }
  const opponent: Side = side === 'player' ? 'navi' : 'player';
  const opponentHand = opponent === 'player' ? state.player : state.navi;
  const opponentMelding = bestMelding(opponentHand);

  const wasGin = knockerMelding.deadwoodValue === 0;
  const diff = opponentMelding.deadwoodValue - knockerMelding.deadwoodValue;

  let winner: Side | 'draw';
  let points = 0;
  if (wasGin) {
    winner = side;
    points = opponentMelding.deadwoodValue + 25; // gin bonus
  } else if (diff > 0) {
    winner = side;
    points = diff;
  } else if (diff < 0) {
    // Undercut — opponent had lower deadwood than knocker. Opponent wins.
    winner = opponent;
    points = -diff + 25; // undercut bonus
  } else {
    winner = 'draw';
    points = 0;
  }

  const newDiscard = [...state.discard, card];
  const playerMelding = side === 'player' ? knockerMelding : opponentMelding;
  const naviMelding   = side === 'navi'   ? knockerMelding : opponentMelding;

  return {
    ...state,
    phase: 'gameover',
    discard: newDiscard,
    player: side === 'player' ? remaining : state.player,
    navi:   side === 'navi'   ? remaining : state.navi,
    outcome: {
      knocker: side,
      wasGin,
      playerMelding,
      naviMelding,
      winner,
      points,
    },
  };
}

function makeDrawOutcome(state: RummyState): RummyState['outcome'] {
  const playerMelding = bestMelding(state.player);
  const naviMelding   = bestMelding(state.navi);
  return {
    knocker: 'player',
    wasGin: false,
    playerMelding,
    naviMelding,
    winner: 'draw',
    points: 0,
  };
}

// ─── AI helpers (hand-agnostic) ───────────────────────────────────────────────

/**
 * Given an 11-card hand, return the minimum deadwood achievable across all
 * possible discards. Used for draw decisions and knock eligibility checks.
 */
function bestDiscardDeadwood(hand11: Card[]): number {
  let min = Infinity;
  for (let i = 0; i < hand11.length; i++) {
    const rest = hand11.filter((_, j) => j !== i);
    const m = bestMelding(rest).deadwoodValue;
    if (m < min) min = m;
  }
  return min;
}

/**
 * Decide whether to draw from stock or discard for a given hand. Takes the
 * top discard if it strictly reduces deadwood after an optimal discard;
 * otherwise draws from stock.
 */
function chooseDrawSource(hand: Card[], discardPile: Card[]): DrawSource {
  const baseline = bestMelding(hand).deadwoodValue;
  if (discardPile.length === 0) return 'stock';
  const top = discardPile[discardPile.length - 1];
  const hypothetical = [...hand, top];
  const afterDiscardBest = bestDiscardDeadwood(hypothetical);
  return afterDiscardBest < baseline ? 'discard' : 'stock';
}

/**
 * Pick the card to discard from a given hand. Minimises post-discard deadwood;
 * ties broken by preferring to keep cards that form runs (discard highest-value
 * deadwood first).
 */
function chooseDiscardFromHand(hand: Card[]): number {
  let bestIdx = 0;
  let bestDw = Infinity;
  let bestPoints = -Infinity;
  for (let i = 0; i < hand.length; i++) {
    const rest = hand.filter((_, j) => j !== i);
    const dw = bestMelding(rest).deadwoodValue;
    const pts = ginPoints(hand[i]);
    if (dw < bestDw || (dw === bestDw && pts > bestPoints)) {
      bestDw = dw;
      bestIdx = i;
      bestPoints = pts;
    }
  }
  return hand[bestIdx].id;
}

/**
 * Return the card id to knock-discard when eligible (deadwood ≤ 10 after
 * discarding it), or null to keep playing.
 */
function chooseKnockFromHand(hand: Card[]): number | null {
  let bestIdx = -1;
  let bestDw = Infinity;
  for (let i = 0; i < hand.length; i++) {
    const rest = hand.filter((_, j) => j !== i);
    const dw = bestMelding(rest).deadwoodValue;
    if (dw < bestDw) { bestDw = dw; bestIdx = i; }
  }
  // Always knock when eligible — aggressive knocking gives the human more agency.
  if (bestIdx >= 0 && bestDw <= 10) return hand[bestIdx].id;
  return null;
}

// ─── AI (per-side public API) ─────────────────────────────────────────────────

export function naviChooseDraw(state: RummyState): DrawSource {
  return chooseDrawSource(state.navi, state.discard);
}
export function naviChooseDiscard(state: RummyState): number {
  return chooseDiscardFromHand(state.navi);
}
export function naviChooseKnock(state: RummyState): number | null {
  return chooseKnockFromHand(state.navi);
}

/** Same decisions applied to the player's hand — used by the autoSim. */
export function playerChooseDraw(state: RummyState): DrawSource {
  return chooseDrawSource(state.player, state.discard);
}
export function playerChooseDiscard(state: RummyState): number {
  return chooseDiscardFromHand(state.player);
}
export function playerChooseKnock(state: RummyState): number | null {
  return chooseKnockFromHand(state.player);
}
