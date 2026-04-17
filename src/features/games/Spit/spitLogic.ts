import type { Card } from '../types';

// Pure rules for Spit (simplified single-round version).
//
// Setup per side:
//   • 5 stockpiles of sizes 1..5 (top card face-up; rest face-down)
//   • an 11-card "spit" reserve (face-down)
// Shared:
//   • two center piles, each seeded with one flipped spit card
//
// Play (real-time):
//   • either side may move the top card of any stockpile onto either center
//     pile if its rank is one above or one below the center's top card.
//     Aces wrap: A ↔ 2 and K ↔ A.
//   • equal ranks cannot be played.
//   • when both sides are stuck, either may trigger a "spit" — one card
//     flipped from each reserve onto the respective center pile.
//
// Win: first side to empty all 5 stockpiles wins. If both are stuck and the
// spit reserves are exhausted, fewer remaining cards wins (ties favour the
// human so the game never ends on a shrug).

export type Side = 'player' | 'navi';

export type SideState = {
  stockpiles: Card[][]; // length 5; top of each pile is array[last]
  spit: Card[];         // face-down reserve; top is array[last]
};

export type SpitState = {
  player: SideState;
  navi: SideState;
  center: [Card[], Card[]]; // two shared piles
};

export type Move = { pileIdx: number; centerIdx: 0 | 1 };

export function topOf(pile: Card[]): Card | undefined {
  return pile.length ? pile[pile.length - 1] : undefined;
}

/** True when `card` is one rank above or below `target` (Ace wraps). */
export function canPlayOn(card: Card, target: Card | undefined): boolean {
  if (!target) return false;
  const a = card.value;
  const b = target.value;
  if (a === b) return false;
  if (Math.abs(a - b) === 1) return true;
  // Wrap around the top of the deck: A (14) ↔ 2 (2).
  if ((a === 14 && b === 2) || (a === 2 && b === 14)) return true;
  return false;
}

export function legalMovesFor(side: SideState, center: SpitState['center']): Move[] {
  const out: Move[] = [];
  const c0 = topOf(center[0]);
  const c1 = topOf(center[1]);
  side.stockpiles.forEach((p, i) => {
    const t = topOf(p);
    if (!t) return;
    if (canPlayOn(t, c0)) out.push({ pileIdx: i, centerIdx: 0 });
    if (canPlayOn(t, c1)) out.push({ pileIdx: i, centerIdx: 1 });
  });
  return out;
}

export function applyMove(
  side: SideState,
  center: SpitState['center'],
  move: Move,
): { side: SideState; center: SpitState['center'] } {
  const pile = side.stockpiles[move.pileIdx];
  const card = pile[pile.length - 1];
  const newPile = pile.slice(0, -1);
  const stockpiles = side.stockpiles.map((p, i) => (i === move.pileIdx ? newPile : p));
  const newCenter: SpitState['center'] = [
    move.centerIdx === 0 ? [...center[0], card] : center[0],
    move.centerIdx === 1 ? [...center[1], card] : center[1],
  ];
  return { side: { ...side, stockpiles }, center: newCenter };
}

/** Both sides have at least one spit card — a symmetric flip is possible. */
export function canSpit(state: SpitState): boolean {
  return state.player.spit.length > 0 && state.navi.spit.length > 0;
}

/**
 * Looser check: at least ONE side has a spit card. Used to decide whether the
 * SPIT button stays live — in real life, if a player runs out of reserve
 * cards, the other player can still flip to keep the game moving. The centre
 * piles are shared, so a fresh card from either side unblocks everyone.
 */
export function canAnySpit(state: SpitState): boolean {
  return state.player.spit.length > 0 || state.navi.spit.length > 0;
}

/**
 * Flip one card from each side's spit reserve onto its centre pile. If a side
 * is out of reserve, the OTHER side covers by flipping a second card onto the
 * empty side's centre pile — simulating the in-person etiquette where the
 * player who still has cards funds both flips so the round can continue.
 * Caller should gate on `canAnySpit` to avoid a no-op when both are empty.
 */
export function applySpit(state: SpitState): SpitState {
  let pSpit = state.player.spit;
  let nSpit = state.navi.spit;
  let c0 = state.center[0];
  let c1 = state.center[1];

  const playerHas = pSpit.length > 0;
  const naviHas   = nSpit.length > 0;

  if (playerHas && naviHas) {
    // Both sides flip — two centre piles.
    c0 = [...c0, pSpit[pSpit.length - 1]];
    c1 = [...c1, nSpit[nSpit.length - 1]];
    pSpit = pSpit.slice(0, -1);
    nSpit = nSpit.slice(0, -1);
  } else if (playerHas) {
    // Only player has spit — one centre pile only.
    c0 = [...c0, pSpit[pSpit.length - 1]];
    pSpit = pSpit.slice(0, -1);
  } else if (naviHas) {
    // Only navi has spit — one centre pile only.
    c1 = [...c1, nSpit[nSpit.length - 1]];
    nSpit = nSpit.slice(0, -1);
  }

  return {
    player: { ...state.player, spit: pSpit },
    navi:   { ...state.navi,   spit: nSpit },
    center: [c0, c1],
  };
}

export function stockpilesEmpty(s: SideState): boolean {
  return s.stockpiles.every((p) => p.length === 0);
}

/**
 * Real Spit allows a player with an empty stockpile slot to move the top of
 * any non-empty pile into the empty one — opens up whatever was beneath and
 * keeps the hand compact.
 *
 * This isn't a centre-pile move (so it doesn't require rank adjacency), it's
 * just a pile-to-pile slide. Available as long as at least one slot is empty
 * AND at least one other slot has ≥1 card.
 */
export function canFillEmpty(s: SideState): boolean {
  let hasEmpty = false;
  let hasSource = false;
  for (const p of s.stockpiles) {
    if (p.length === 0) hasEmpty = true;
    else hasSource = true;
  }
  return hasEmpty && hasSource;
}

/**
 * Pick a good source pile to fill `targetIdx`. Strategy: take from the
 * LARGEST pile — exposes the most new cards underneath. Ties broken by
 * lowest index (stable, readable).
 */
export function pickFillSource(s: SideState, targetIdx: number): number | null {
  let bestIdx = -1;
  let bestLen = 0;
  s.stockpiles.forEach((p, i) => {
    if (i === targetIdx) return;
    if (p.length > bestLen) {
      bestLen = p.length;
      bestIdx = i;
    }
  });
  return bestIdx >= 0 ? bestIdx : null;
}

/**
 * Move the top card of `sourceIdx` into `targetIdx` (which must be empty).
 * Does NOT touch the centre piles — this is purely a reorganisation within
 * one side's stockpiles.
 */
export function applyFillEmpty(
  side: SideState,
  sourceIdx: number,
  targetIdx: number,
): SideState {
  const source = side.stockpiles[sourceIdx];
  if (source.length === 0) return side;
  if (side.stockpiles[targetIdx].length !== 0) return side;
  const card = source[source.length - 1];
  const newSource = source.slice(0, -1);
  const newTarget = [card];
  const stockpiles = side.stockpiles.map((p, i) => {
    if (i === sourceIdx) return newSource;
    if (i === targetIdx) return newTarget;
    return p;
  });
  return { ...side, stockpiles };
}

/** No side has any playable centre move AND no side has a fillable empty. */
export function isStuck(state: SpitState): boolean {
  return (
    legalMovesFor(state.player, state.center).length === 0 &&
    legalMovesFor(state.navi,   state.center).length === 0
  );
}

/**
 * True when a side has at least one empty slot AND at least one source pile
 * with MORE than one card — i.e. a fill would actually reveal a new top
 * card, which could unblock a centre play. A source pile with exactly one
 * card can still be slid into an empty slot (that's what `canFillEmpty`
 * allows), but doing so reveals nothing new, so we don't count it as a
 * reason to keep SPIT disabled.
 */
export function canProductiveFill(s: SideState): boolean {
  let hasEmpty = false;
  for (const p of s.stockpiles) {
    if (p.length === 0) { hasEmpty = true; break; }
  }
  if (!hasEmpty) return false;
  for (const p of s.stockpiles) {
    if (p.length > 1) return true;
  }
  return false;
}

/**
 * Stricter than isStuck — also requires neither side to be able to
 * PRODUCTIVELY fill an empty slot (a fill that reveals a new top card,
 * which could unblock play). Lone-card shuffles between slots don't count.
 * Only when totally stuck does SPIT become legal.
 */
export function isTotallyStuck(state: SpitState): boolean {
  if (!isStuck(state)) return false;
  if (canProductiveFill(state.player)) return false;
  if (canProductiveFill(state.navi))   return false;
  return true;
}

/**
 * Un-resolvable deadlock: board is totally stuck and neither side has a
 * spit reserve to fund a flip. Game must end; caller decides how (typically
 * the side with fewer total cards wins).
 */
export function isDeadlock(state: SpitState): boolean {
  return isTotallyStuck(state) && !canAnySpit(state);
}

export function sideTotal(s: SideState): number {
  return s.spit.length + s.stockpiles.reduce((n, p) => n + p.length, 0);
}

/**
 * Tiebreaker for deadlocks: whoever has fewer total cards was closest to
 * clearing the deck, so they win. Ties resolve to the player (human-
 * friendly — the game is hard enough without losing on a coin flip).
 */
export function deadlockWinner(state: SpitState): Side {
  const p = sideTotal(state.player);
  const n = sideTotal(state.navi);
  if (p === n) return 'player';
  return p < n ? 'player' : 'navi';
}

/** Every card a side currently owns (stockpile + spit reserve, any order). */
export function collectSideCards(s: SideState): Card[] {
  const out: Card[] = [...s.spit];
  for (const p of s.stockpiles) out.push(...p);
  return out;
}

/**
 * True when a round has ended — one side has cleared all five stockpiles.
 * The centre piles still exist; the SLAP phase resolves who gets which.
 */
export function roundEnded(state: SpitState): boolean {
  return stockpilesEmpty(state.player) || stockpilesEmpty(state.navi);
}

/**
 * Lay a list of cards out into a SideState: 1-2-3-4-5 stockpiles (smallest
 * piles first), remainder goes to the spit reserve. Fewer than 15 cards →
 * the later stockpiles stay empty.
 */
export function dealSide(cards: Card[]): SideState {
  const stockpiles: Card[][] = [[], [], [], [], []];
  let idx = 0;
  for (let i = 0; i < 5 && idx < cards.length; i++) {
    const pileSize = i + 1;
    const take = Math.min(pileSize, cards.length - idx);
    stockpiles[i] = cards.slice(idx, idx + take);
    idx += take;
  }
  const spit = idx < cards.length ? cards.slice(idx) : [];
  return { stockpiles, spit };
}

/**
 * Resolve a SLAP: whoever slapped first picks up `claimedIdx`. In real Spit
 * you WANT the smaller pile (fewer cards to absorb back into your deck), but
 * the rule here just says "slapper gets the pile they clicked". The loser
 * takes the other pile. All cards from both sides then get reshuffled into
 * fresh 1-2-3-4-5 stockpile layouts for the next round.
 */
export function applySlap(
  state: SpitState,
  slapper: Side,
  claimedIdx: 0 | 1,
  shuffler: <T>(a: T[]) => T[],
): SpitState {
  const otherIdx: 0 | 1 = claimedIdx === 0 ? 1 : 0;
  const slapperPile = state.center[claimedIdx];
  const otherPile   = state.center[otherIdx];

  const playerPile = slapper === 'player' ? slapperPile : otherPile;
  const naviPile   = slapper === 'navi'   ? slapperPile : otherPile;

  const playerCards = shuffler([...collectSideCards(state.player), ...playerPile]);
  const naviCards   = shuffler([...collectSideCards(state.navi),   ...naviPile]);

  return {
    player: dealSide(playerCards),
    navi:   dealSide(naviCards),
    center: [[], []],
  };
}

/** Final game over — one side has literally zero cards anywhere. */
export function gameWinner(state: SpitState): Side | null {
  if (sideTotal(state.player) === 0) return 'player';
  if (sideTotal(state.navi)   === 0) return 'navi';
  return null;
}

/**
 * After a slap redistribution, check whether a side has no spit reserve
 * (≤15 cards, all went to stockpiles). That side is "winning" — they're
 * closest to clearing out — but they can't flip a spit card. One card is
 * borrowed from the opponent to act as their face-down spit card.
 *
 * Returns the side that needs the endgame setup, or null if both sides
 * have spit reserves.
 */
export function needsEndgameRound(state: SpitState): Side | null {
  const pEmpty = state.player.spit.length === 0;
  const nEmpty = state.navi.spit.length === 0;
  // If BOTH are out of spit, the normal stuck/deadlock logic handles it.
  if (pEmpty && !nEmpty) return 'player';
  if (nEmpty && !pEmpty) return 'navi';
  return null;
}

/**
 * Set up the endgame round. The winning side has stockpile cards but no
 * spit reserve. One card is borrowed from the opponent and placed
 * face-down in the centre at the winner's spit position (centre[0] for
 * player, centre[1] for navi). Both sides play normally — the winner
 * still has stockpile cards to clear.
 *
 * If the winner clears their stockpiles → they have 0 total cards → win.
 * If the loser clears first → loser takes the 1 face-down card, winner
 * takes the big centre pile, both redeal.
 * If deadlock → fewer cards wins (winner likely wins).
 */
export function applyEndgameSetup(
  state: SpitState,
  winningSide: Side,
): { state: SpitState; facedownCard: Card } {
  const loser = winningSide === 'player' ? state.navi : state.player;
  const winner = winningSide === 'player' ? state.player : state.navi;

  // Borrow one card from the loser (opponent) for the face-down spit card.
  let card: Card;
  let newLoser: SideState;
  if (loser.spit.length > 0) {
    card = loser.spit[loser.spit.length - 1];
    newLoser = { ...loser, spit: loser.spit.slice(0, -1) };
  } else {
    let bestIdx = 0;
    for (let i = 1; i < loser.stockpiles.length; i++) {
      if (loser.stockpiles[i].length > loser.stockpiles[bestIdx].length) bestIdx = i;
    }
    const pile = loser.stockpiles[bestIdx];
    card = pile[pile.length - 1];
    const newPiles = loser.stockpiles.map((p, i) =>
      i === bestIdx ? p.slice(0, -1) : p,
    );
    newLoser = { ...loser, stockpiles: newPiles };
  }

  // The face-down card is returned separately — it sits visually in the
  // centre but is NOT part of the game state's center piles (so nobody
  // can play onto it). The component tracks it and adds it back during
  // the slap phase.
  return {
    state: {
      player: winningSide === 'player' ? winner : newLoser,
      navi:   winningSide === 'navi'   ? winner : newLoser,
      center: [[], []] as [Card[], Card[]],
    },
    facedownCard: card,
  };
}

/**
 * Resolve the endgame slap when the LOSING side cleared their stockpiles.
 * The loser gets just 1 card; the winner (who failed to play their card
 * first) takes everything else. Both sides redeal.
 */
export function applyEndgameSlap(
  state: SpitState,
  winningSide: Side,
  shuffler: <T>(a: T[]) => T[],
): SpitState {
  // Gather every card in play.
  const all = shuffler([
    ...collectSideCards(state.player),
    ...collectSideCards(state.navi),
    ...state.center[0],
    ...state.center[1],
  ]);

  // Loser who cleared gets 1 card; winner takes the rest.
  const loserCards = [all[0]];
  const winnerCards = all.slice(1);

  return {
    player: winningSide === 'player' ? dealSide(winnerCards) : dealSide(loserCards),
    navi:   winningSide === 'navi'   ? dealSide(winnerCards) : dealSide(loserCards),
    center: [[], []],
  };
}

/** Deal a freshly shuffled 52-card deck into an initial state.
 *  Centre piles start empty — the player triggers the first spit flip. */
export function dealInitial(deck: Card[]): SpitState {
  const pCards = deck.slice(0, 26);
  const nCards = deck.slice(26);
  const buildSide = (cards: Card[]): SideState => {
    const stockpiles: Card[][] = [];
    let idx = 0;
    for (let i = 1; i <= 5; i++) {
      stockpiles.push(cards.slice(idx, idx + i));
      idx += i;
    }
    return { stockpiles, spit: cards.slice(idx) };
  };
  return {
    player: buildSide(pCards),
    navi:   buildSide(nCards),
    center: [[], []],
  };
}
