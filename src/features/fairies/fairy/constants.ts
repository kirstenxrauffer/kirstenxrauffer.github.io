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
export const STANDOFF_DIST = 45; // px — distance from cursor at which approach ends; matches ORBIT_RADIUS_BASE for smooth handoff
export const APPROACH_BRAKE_DIST = 90; // px — distance from standoff at which braking begins
export const HYSTERESIS = 15; // px beyond detectRadius before orbit → WANDER
export const EDGE_AVOID = 40; // px
export const FAIRY_REPEL_DISTANCE = 80; // px; fairies repel each other beyond this distance
export const FAIRY_SCALE = 0.25; // world px per local unit; 33 * 3.5 ≈ 115px wide

// Orbit constants — entered immediately after the fairy reaches the standoff point.
// Radius oscillates with two overlapping sines starting at 0 (phase=0 → r=ORBIT_RADIUS_BASE).
// BASE and VARIANCE are tuned so the absolute min radius (BASE − 1.5·VARIANCE)
// is 30 px, keeping navi at least 30 px from the cursor at all times.
export const ORBIT_ANGULAR_SPEED  = 0.5;  // rad/s — ~12.5 s per full orbit
export const ORBIT_RADIUS_BASE    = 45;   // px from cursor; initial orbit radius
export const ORBIT_RADIUS_VARIANCE = 10;  // px; range ≈ 30–60 px from cursor
export const ORBIT_PHASE_SPEED    = 0.3;  // rad/s — radius oscillation period ≈ 21 s
export const ORBIT_SPEED          = 60;   // px/s — chase speed for orbit target

// Flee constants — entered when the nav menu opens.
export const FLEE_SPEED        = 80;   // px/s — brisk departure
export const FLEE_ARRIVAL_DIST = 50;   // px — close enough to the flee target to switch to wander
export const NAV_AVOID_RADIUS  = 180;  // px — bubble around nav click pos navi stays outside

// NavOrbit constants — entered when the user opens the nav by clicking navi.
// Navi orbits the whole nav container ONCE at half speed, then transitions to
// flying to the cursor to offer a game.
export const NAV_TRAVEL_SPEED      = 280;  // px/s — brisk approach to the container
export const NAV_ORBIT_RADIUS_PAD  = 55;   // px — gap between container bounds and orbit ring
export const NAV_ORBIT_ANG_SPEED   = 1.3;  // rad/s — half of the previous 2.6 rad/s
export const NAV_ORBIT_REVOLUTIONS = 1;    // full turns around the container before exit

// Game-prompt flight constants — after the container orbit Navi flies to the cursor.
export const GAME_APPROACH_SPEED   = 260;  // px/s — quick but readable
export const GAME_APPROACH_ARRIVE  = 60;   // px from cursor at which the prompt opens

// Win/lose mood constants.
export const ANGRY_SHAKE_HZ        = 14;   // cycles/s of side-to-side shake
export const ANGRY_SHAKE_AMP       = 12;   // px — peak horizontal displacement
export const CELEBRATE_LAP_SPEED   = 320;  // px/s — victory-lap travel speed
export const CELEBRATE_LAP_INSET   = 120;  // px inset from viewport edge for the lap path

// Center-text avoidance — keeps the fairy out of the viewport's central content zone.
// Fractions of viewport width/height define the ellipse semi-axes.
export const CENTER_AVOID_RX_FRAC = 0.28; // ~360px on a 1280px screen
export const CENTER_AVOID_RY_FRAC = 0.24; // ~173px on a 720px screen
