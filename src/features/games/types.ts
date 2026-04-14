import type { ComponentType } from 'react';

export type Suit = '♥' | '♦' | '♠' | '♣';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type SuitColor = 'red' | 'black';

export type Card = {
  id: number;        // stable id across shuffle animations
  rank: Rank;
  suit: Suit;
  color: SuitColor;
  /** Numeric comparator value: A high (14), K=13, Q=12, J=11, then 10..2. */
  value: number;
};

export type GameResult = 'win' | 'lose' | 'draw';

/** Props every game UI receives from the GameOverlay shell. */
export type GameProps = {
  /**
   * Called when the game is over. Pass 'win' when navi wins, 'lose' when
   * the player wins — navi's mood is driven from navi's perspective.
   */
  onEnd: (result: GameResult) => void;
  /** Called when the user closes the modal without finishing. */
  onClose: () => void;
};

/** Registry entry — one per game. */
export type GameEntry = {
  id: string;
  label: string;             // shown in the prompt tooltip button
  /** Lazy component so initial bundle stays lean. */
  component: () => Promise<{ default: ComponentType<GameProps> }>;
  /** False → button disabled + greyed out ("coming soon"). */
  available: boolean;
};
