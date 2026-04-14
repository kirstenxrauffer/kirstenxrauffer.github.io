import type { Card } from '../types';

// War game pure logic. The UI calls playRound() on each click and animates
// the returned transitions. Keeping this pure means we can unit-test rules
// without pulling in React/DOM.

export type Side = 'player' | 'navi';

export type RoundOutcome =
  | { kind: 'win'; winner: Side; playerCard: Card; naviCard: Card; pot: Card[] }
  | { kind: 'war'; playerCard: Card; naviCard: Card; burned: Card[]; resolution: RoundOutcome };

export type RoundResult = {
  outcome: RoundOutcome;
  nextPlayer: Card[];
  nextNavi: Card[];
};

/**
 * Play a single round. If the top cards tie, recurse into a "war":
 *   each side burns up to 3 face-down cards + flips 1 face-up. Whoever wins
 *   the face-up comparison takes everything in the pot.
 *
 * Edge case — running out during a war: if either side doesn't have enough
 * cards to fund the war, they lose the game. We surface that by returning
 * an outcome where the opponent wins the pot and the short side's hand is [].
 *
 * Both input arrays are treated as stacks with index 0 = top.
 */
export function playRound(player: Card[], navi: Card[]): RoundResult {
  if (player.length === 0) {
    return { outcome: { kind: 'win', winner: 'navi', playerCard: null as unknown as Card, naviCard: navi[0], pot: [] }, nextPlayer: [], nextNavi: navi };
  }
  if (navi.length === 0) {
    return { outcome: { kind: 'win', winner: 'player', playerCard: player[0], naviCard: null as unknown as Card, pot: [] }, nextPlayer: player, nextNavi: [] };
  }
  return resolve(player, navi, []);
}

function resolve(player: Card[], navi: Card[], carry: Card[]): RoundResult {
  const pc = player[0];
  const nc = navi[0];
  const rest1 = player.slice(1);
  const rest2 = navi.slice(1);
  const pot = [...carry, pc, nc];

  if (pc.value > nc.value) {
    return {
      outcome: { kind: 'win', winner: 'player', playerCard: pc, naviCard: nc, pot },
      nextPlayer: [...rest1, ...pot],
      nextNavi: rest2,
    };
  }
  if (nc.value > pc.value) {
    return {
      outcome: { kind: 'win', winner: 'navi', playerCard: pc, naviCard: nc, pot },
      nextPlayer: rest1,
      nextNavi: [...rest2, ...pot],
    };
  }

  // Invariant: we only reach the WAR branch on a true tie. If this ever fires
  // it indicates a corrupt Card (value/rank out of sync) or a logic regression.
  if (pc.value !== nc.value) {
    throw new Error(
      `war triggered without a tie: player=${pc.rank}(${pc.value}) vs navi=${nc.rank}(${nc.value})`,
    );
  }

  // WAR — burn up to 3 face-down each, then flip the 4th. If either side
  // can't supply that many, they lose everything in the pot.
  const burnCount = Math.min(3, rest1.length, rest2.length);
  const pBurn = rest1.slice(0, burnCount);
  const nBurn = rest2.slice(0, burnCount);
  const pAfterBurn = rest1.slice(burnCount);
  const nAfterBurn = rest2.slice(burnCount);

  if (pAfterBurn.length === 0 && nAfterBurn.length === 0) {
    // Simultaneous bust — give the pot to whoever burned fewer (they had less
    // to give, but rules vary; easiest is "draw, split evenly"). We declare
    // navi winner to resolve deterministically.
    return {
      outcome: {
        kind: 'war',
        playerCard: pc,
        naviCard: nc,
        burned: [...pBurn, ...nBurn],
        resolution: { kind: 'win', winner: 'navi', playerCard: pc, naviCard: nc, pot: [...pot, ...pBurn, ...nBurn] },
      },
      nextPlayer: [],
      nextNavi: [],
    };
  }
  if (pAfterBurn.length === 0) {
    const fullPot = [...pot, ...pBurn, ...nBurn];
    return {
      outcome: {
        kind: 'war',
        playerCard: pc,
        naviCard: nc,
        burned: [...pBurn, ...nBurn],
        resolution: { kind: 'win', winner: 'navi', playerCard: pc, naviCard: nc, pot: fullPot },
      },
      nextPlayer: [],
      nextNavi: [...nAfterBurn, ...fullPot],
    };
  }
  if (nAfterBurn.length === 0) {
    const fullPot = [...pot, ...pBurn, ...nBurn];
    return {
      outcome: {
        kind: 'war',
        playerCard: pc,
        naviCard: nc,
        burned: [...pBurn, ...nBurn],
        resolution: { kind: 'win', winner: 'player', playerCard: pc, naviCard: nc, pot: fullPot },
      },
      nextPlayer: [...pAfterBurn, ...fullPot],
      nextNavi: [],
    };
  }

  const deeper = resolve(pAfterBurn, nAfterBurn, [...pot, ...pBurn, ...nBurn]);
  return {
    outcome: {
      kind: 'war',
      playerCard: pc,
      naviCard: nc,
      burned: [...pBurn, ...nBurn],
      resolution: deeper.outcome,
    },
    nextPlayer: deeper.nextPlayer,
    nextNavi: deeper.nextNavi,
  };
}

/** Terminal state check — true when either hand is empty. */
export function isGameOver(player: Card[], navi: Card[]): boolean {
  return player.length === 0 || navi.length === 0;
}

/** Winner: 'player' | 'navi' | null (still going). */
export function winner(player: Card[], navi: Card[]): Side | null {
  if (!isGameOver(player, navi)) return null;
  return player.length === 0 ? 'navi' : 'player';
}
