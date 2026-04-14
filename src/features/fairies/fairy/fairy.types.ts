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
      // Orbit the whole nav-container bounding circle ONCE at half speed.
      // Phase 'travel' lerps centre from travelFrom → container centre while
      // orbitAngle advances, producing one continuous swirl into the ring.
      kind: 'navOrbit';
      center: Vec2;
      radius: number;
      phase: 'travel' | 'orbit';
      orbitAngle: number;
      orbitTurn: number;
      orbitDir: 1 | -1;
      travelFrom: Vec2;
      travelT: number;
      travelDuration: number;
    }
  | {
      // After the container orbit: fly toward the live cursor. On arrival
      // within GAME_APPROACH_ARRIVE, fires navArea.gamePromptOpen.
      kind: 'gameApproach';
    }
  | {
      // Idling close to the cursor while the game-prompt tooltip is shown.
      kind: 'gameIdle';
    }
  | {
      // Shake side-to-side angrily with a red glow.
      kind: 'angry';
      startedAt: number;
      anchor: Vec2;
    }
  | {
      // Victory lap: loop the viewport perimeter with a yellow glow and pollen.
      kind: 'celebrate';
      angle: number;
    };

export type Mood = 'normal' | 'angry' | 'celebrate';

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

  // Mood — drives glow hue and special motion (shake/celebrate). Mutated in
  // place from outside the FSM (e.g. game end).
  mood: Mood;

  // Per-fairy deterministic seed for brush.seed() — pins stamp randomness so
  // the body doesn't shimmer when redrawn each frame.
  rngSeed: number;

  // Visual config.
  flipStyle: FlipStyle;
};
