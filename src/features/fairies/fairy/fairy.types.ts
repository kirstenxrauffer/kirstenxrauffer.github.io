// Pure types for the fairy feature. No runtime, no p5.
// Kept separate from factory/draw so behavior/* can import without
// pulling in p5 symbols.

export type Vec2 = { x: number; y: number };

export type World = { w: number; h: number };

// Discriminated union: one shape per FSM state.
// Only kind-specific fields live on each variant so we never store stale
// data across transitions.
export type FSMState =
  | { kind: 'wander'; nextHeadingAt: number }
  | { kind: 'approach'; target: Vec2; enteredAt: number }
  | { kind: 'orbit'; orbitAngle: number; orbitPhase: number; orbitDir: 1 | -1 }
  | { kind: 'flee'; targetPos: Vec2 }
  | {
      kind: 'navOrbit';
      links: Vec2[];
      current: number;
      phase: 'travel' | 'orbit';
      orbitAngle: number;
      orbitTurn: number;
      orbitDir: 1 | -1;
      // Travel phase: orbit centre lerps from travelFrom → links[current] over
      // travelDuration, while orbitAngle keeps advancing — produces one
      // continuous swirling path between buttons rather than a diagonal cut.
      travelFrom: Vec2;
      travelT: number;
      travelDuration: number;
    };

export type FlipStyle = 'pitch' | 'yaw';

export type Fairy = {
  id: string;

  // Kinematics — all mutated in place by tickFairy for hot-loop speed.
  pos: Vec2;
  vel: Vec2;
  heading: number; // radians; +X = forward
  scale: number;

  // Rendering phases.
  wingPhase: number;  // radians; accumulates over time
  flipPhase: number;  // 0..1 during backflip, 0 otherwise
  wingFlipT: number;  // 0 = facing left, 1 = facing right; lerped each frame for smooth rotation
  eyeFlipT: number;   // same 0/1 direction but lerped much slower — drives eye-size cross-fade
  hoverT: number;     // 0 = not hovered, 1 = fully hovered; lerped each frame for smooth transitions

  // Smoothed pupil offsets in LOCAL frame.
  eyeA: Vec2;
  eyeB: Vec2;

  // Behavior.
  fsm: FSMState;

  // Per-fairy deterministic seed for brush.seed() — pins stamp randomness so
  // the body doesn't shimmer when redrawn each frame.
  rngSeed: number;

  // Visual config.
  flipStyle: FlipStyle;
};
