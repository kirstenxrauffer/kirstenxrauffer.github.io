// Pure factory for fairies. No p5, no brush. Safe to unit test.

import type { Fairy, FlipStyle } from './fairy.types';
import { EYE_A, EYE_B, FAIRY_SCALE } from './constants';

export type CreateFairyArgs = {
  id: string;
  pos: { x: number; y: number };
  heading?: number;
  rngSeed?: number;
  flipStyle?: FlipStyle;
  scale?: number;
};

export function createFairy(args: CreateFairyArgs): Fairy {
  const heading = args.heading ?? Math.random() * Math.PI * 2;
  return {
    id: args.id,
    pos: { x: args.pos.x, y: args.pos.y },
    vel: { x: 0, y: 0 },
    heading,
    scale: args.scale ?? FAIRY_SCALE,
    wingPhase: Math.random() * Math.PI * 2,
    flipPhase: 0,
    wingFlipT: 0,
    eyeFlipT: 0,
    hoverT: 0,
    eyeA: { ...EYE_A.defaultOffset },
    eyeB: { ...EYE_B.defaultOffset },
    fsm: { kind: 'wander', nextHeadingAt: 0 },
    mood: 'normal',
    rngSeed: args.rngSeed ?? Math.floor(Math.random() * 1e9),
    flipStyle: args.flipStyle ?? 'pitch',
  };
}
