import type { Card, Rank, Suit } from './types';

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS: Suit[] = ['♥', '♦', '♠', '♣'];

function rankValue(r: Rank): number {
  if (r === 'A') return 14;
  if (r === 'K') return 13;
  if (r === 'Q') return 12;
  if (r === 'J') return 11;
  return parseInt(r, 10);
}

/** 52-card ordered deck. Caller shuffles. Card ids are stable 1..52 for React keys. */
export function makeDeck(): Card[] {
  const out: Card[] = [];
  let id = 1;
  for (const s of SUITS) {
    for (const r of RANKS) {
      out.push({
        id: id++,
        rank: r,
        suit: s,
        color: (s === '♥' || s === '♦') ? 'red' : 'black',
        value: rankValue(r),
      });
    }
  }
  return out;
}

/** Fisher-Yates in place. Returns the same array for chaining. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Deal the deck into two halves. Assumes deck length is even. */
export function dealHalves<T>(deck: T[]): [T[], T[]] {
  const half = deck.length / 2;
  return [deck.slice(0, half), deck.slice(half)];
}
