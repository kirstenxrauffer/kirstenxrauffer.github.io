// Frozen anatomical constants for the fairy.
// All coordinates are in the fairy's local 33x24 frame — same as the source
// fairy.svg viewBox. A fairy at world-heading=0 faces +X, which puts the
// front wing (cx=25.33) on the leading edge.
//
// Wing pivots are computed from the SVG major-axis endpoint closest to
// the body center (14.5, 16.28). See §2 of docs/fairy-plan.md for the
// worked example.
//
// baseRot values:
//   BACK_WING  -49.29° = -0.8604 rad
//   FRONT_WING -18.11° = -0.3161 rad

export const CANONICAL_W = 33;
export const CANONICAL_H = 24;
export const CANONICAL_CX = 16.5;
export const CANONICAL_CY = 12;

export type WingSpec = {
  center: { x: number; y: number };
  r: number;
  baseRot: number;
  pivot: { x: number; y: number };
};

export const BACK_WING: WingSpec = Object.freeze({
  center: { x: 15, y: -40 },
  r: 68,
  baseRot: -0.86,
  pivot: { x: -14, y: -2 },
});

export const FRONT_WING: WingSpec = Object.freeze({
  center: { x: 60, y: -25 },
  r: 68,
  baseRot: -0.316,
  pivot: { x: 26, y: 3 },
});

export type EyeSpec = {
  cx: number;
  cy: number;
  sclera: number;
  pupilR: number;
  maxR: number;
  defaultOffset: { x: number; y: number };
  renderOffset: { x: number; y: number };
};

export const EYE_SIZES = Object.freeze({
  A: { scleraR: 79.7, pupilR: 20.87 },
  B: { scleraR: 91.08, pupilR: 25 },
});

export const EYE_A: EyeSpec = Object.freeze({
  cx: -56,
  cy: -2,
  sclera: EYE_SIZES.A.scleraR,
  pupilR: EYE_SIZES.A.pupilR,
  maxR: (EYE_SIZES.A.scleraR - EYE_SIZES.A.pupilR) * 0.9,
  defaultOffset: { x: 0, y: 0 },
  renderOffset: { x: 0, y: 0 },
});

export const EYE_B: EyeSpec = Object.freeze({
  cx: 7,
  cy: 2,
  sclera: EYE_SIZES.B.scleraR,
  pupilR: EYE_SIZES.B.pupilR,
  maxR: (EYE_SIZES.B.scleraR - 5 - EYE_SIZES.B.pupilR) * 0.9,
  defaultOffset: { x: 0, y: 0 },
  renderOffset: { x: -8, y: 0 },
});

// Stripe endpoints (local frame).
export const STRIPE = Object.freeze({
  a: { x: 75, y: 19 },
  b: { x: -50, y: -19 },
});

// Body ellipse.
export const BODY = Object.freeze({
  cx: 2,
  cy: 10,
  r: 38,
});

// Detect radius scaling. 16% of viewport width, clamped to [150, 400].
export function computeDetectRadius(vw: number): number {
  return Math.max(150, Math.min(400, vw * 0.16));
}

// Fairy kinematic constants.
export const WANDER_SPEED = 25; // px/s
export const APPROACH_SPEED = 60; // px/s
export const MAX_STEER_RATE = 1.5; // rad/s
export const ARRIVAL_TOLERANCE = 8; // px — arrival at standoff point
export const STANDOFF_DIST = 20; // px — distance from cursor at which approach ends
export const APPROACH_BRAKE_DIST = 90; // px — distance from standoff at which braking begins
export const HYSTERESIS = 15; // px beyond detectRadius before orbit → WANDER
export const EDGE_AVOID = 40; // px
export const FAIRY_REPEL_DISTANCE = 80; // px; fairies repel each other beyond this distance
export const FAIRY_SCALE = 0.25; // world px per local unit; 33 * 3.5 ≈ 115px wide

// Orbit constants — entered immediately after the fairy reaches the standoff point.
// Radius oscillates with two overlapping sines starting at 0 (phase=0 → r=ORBIT_RADIUS_BASE).
export const ORBIT_ANGULAR_SPEED  = 0.5;  // rad/s — ~12.5 s per full orbit
export const ORBIT_RADIUS_BASE    = 30;   // px from cursor; initial orbit radius
export const ORBIT_RADIUS_VARIANCE = 15;  // px; range ≈ 7–52 px from cursor
export const ORBIT_PHASE_SPEED    = 0.3;  // rad/s — radius oscillation period ≈ 21 s
export const ORBIT_SPEED          = 60;   // px/s — chase speed for orbit target
