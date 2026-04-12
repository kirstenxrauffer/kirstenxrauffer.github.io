// Pure FSM tick for fairies. No p5 imports — takes a noise function instead
// so it remains trivially unit-testable.
//
// FSM:
//   WANDER -(ptr seen)-> APPROACH -(at standoff)-> ORBIT -(ptr lost)-> WANDER
//
// The fairy pursues the live cursor. In APPROACH it targets a standoff point
// STANDOFF_DIST px from the cursor (toward itself), braking as it arrives.
// On arrival it enters ORBIT, continuously circling the cursor at a radius
// that breathes in and out via two overlapping sines — creating the
// "sometimes getting closer, then pulling back" feel.
//
// Side-effects: mutates `fairy` in place.

import type { Fairy, Vec2, World, FSMState } from '../fairy/fairy.types';
import {
  APPROACH_SPEED,
  APPROACH_BRAKE_DIST,
  ARRIVAL_TOLERANCE,
  EDGE_AVOID,
  EYE_A,
  EYE_B,
  MAX_STEER_RATE,
  ORBIT_ANGULAR_SPEED,
  ORBIT_PHASE_SPEED,
  ORBIT_RADIUS_BASE,
  ORBIT_RADIUS_VARIANCE,
  ORBIT_SPEED,
  STANDOFF_DIST,
  WANDER_SPEED,
  FAIRY_REPEL_DISTANCE,
} from '../fairy/constants';
import type { Pointer } from '../input/pointer';

export type NoiseFn = (x: number, y: number, z: number) => number;

const TAU = Math.PI * 2;

function angleDiff(target: number, current: number): number {
  let d = (target - current) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function lerp2(out: Vec2, goal: Vec2, t: number): void {
  out.x += (goal.x - out.x) * t;
  out.y += (goal.y - out.y) * t;
}

// Smooth-steer heading toward desired with a max angular velocity.
function steerHeading(fairy: Fairy, desired: number, dt: number): void {
  const diff = angleDiff(desired, fairy.heading);
  const maxStep = MAX_STEER_RATE * dt;
  const step = Math.max(-maxStep, Math.min(maxStep, diff));
  fairy.heading += step;
}

function updateEyes(fairy: Fairy, target: Vec2 | null): void {
  updateOneEye(fairy, fairy.eyeA, EYE_A.maxR, EYE_A.defaultOffset, target);
  updateOneEye(fairy, fairy.eyeB, EYE_B.maxR, EYE_B.defaultOffset, target);
}

function updateOneEye(
  fairy: Fairy,
  current: Vec2,
  maxR: number,
  defaultOffset: Vec2,
  target: Vec2 | null,
): void {
  if (!target) {
    lerp2(current, defaultOffset, 0.03);
    return;
  }
  const dx = target.x - fairy.pos.x;
  const dy = target.y - fairy.pos.y;

  const len = Math.hypot(dx, dy) || 1;
  const gx = (dx / len) * maxR;
  const gy = (dy / len) * maxR;
  lerp2(current, { x: gx, y: gy }, 0.025);
}

function edgeAvoidBias(fairy: Fairy, world: World): number | null {
  const { x, y } = fairy.pos;
  const dLeft = x;
  const dRight = world.w - x;
  const dTop = y;
  const dBot = world.h - y;
  const nearest = Math.min(dLeft, dRight, dTop, dBot);
  if (nearest > EDGE_AVOID) return null;
  // Steer toward the centre.
  const cx = world.w / 2;
  const cy = world.h / 2;
  return Math.atan2(cy - y, cx - x);
}

function fairyRepelBias(fairy: Fairy, allFairies: Fairy[]): number | null {
  let repelX = 0;
  let repelY = 0;
  let hasRepel = false;

  for (const other of allFairies) {
    if (other.id === fairy.id) continue;
    const dx = fairy.pos.x - other.pos.x;
    const dy = fairy.pos.y - other.pos.y;
    const distSq = dx * dx + dy * dy;
    const minDist = FAIRY_REPEL_DISTANCE;

    if (distSq < minDist * minDist && distSq > 0) {
      const dist = Math.sqrt(distSq);
      repelX += (dx / dist);
      repelY += (dy / dist);
      hasRepel = true;
    }
  }

  if (!hasRepel) return null;
  return Math.atan2(repelY, repelX);
}

export type TickArgs = {
  fairy: Fairy;
  pointer: Pointer;
  dt: number;
  detectRadius: number;
  now: number;
  noise: NoiseFn;
  world: World;
  allFairies: Fairy[];
};

export function tickFairy(args: TickArgs): void {
  const { fairy, pointer, dt, now, noise, world, allFairies } = args;

  // Integrate wingPhase every frame regardless of state.
  fairy.wingPhase += dt * 20;

  // Pointer target: null if we haven't seen it yet.
  const ptrTarget: Vec2 | null = pointer.seen ? { x: pointer.x, y: pointer.y } : null;

  // Eye look-at target: depends on state — set below.
  let eyeTarget: Vec2 | null = null;

  switch (fairy.fsm.kind) {
    case 'wander':
      eyeTarget = null;
      tickWander(fairy, dt, now, noise, world, allFairies);
      // Transition to APPROACH immediately when pointer is seen — no pause.
      if (ptrTarget) {
        fairy.fsm = { kind: 'approach', target: { ...ptrTarget }, enteredAt: now };
      }
      break;

    case 'approach': {
      eyeTarget = ptrTarget;
      const standoff = ptrTarget ? computeStandoff(fairy.pos, ptrTarget) : null;
      tickApproach(fairy, standoff, dt);
      if (ptrTarget && standoff) {
        const dStandoff = Math.hypot(fairy.pos.x - standoff.x, fairy.pos.y - standoff.y);
        if (dStandoff < ARRIVAL_TOLERANCE) {
          // Determine orbit direction: pick whichever tangent best matches current velocity.
          const toFairy = { x: fairy.pos.x - ptrTarget.x, y: fairy.pos.y - ptrTarget.y };
          const tLen = Math.hypot(toFairy.x, toFairy.y) || 1;
          // CCW unit tangent: rotate (toFairy / tLen) by +90° → (-y, x).
          const tx = -toFairy.y / tLen;
          const ty =  toFairy.x / tLen;
          const dot = fairy.vel.x * tx + fairy.vel.y * ty;
          const orbitDir = (dot >= 0 ? 1 : -1) as 1 | -1;
          const enterAngle = Math.atan2(toFairy.y, toFairy.x);
          fairy.fsm = { kind: 'orbit', orbitAngle: enterAngle, orbitPhase: 0, orbitDir };
          break;
        }
      } else {
        fairy.fsm = { kind: 'wander', nextHeadingAt: now + 500 };
      }
      break;
    }

    case 'orbit': {
      eyeTarget = ptrTarget;
      if (!ptrTarget) {
        fairy.fsm = { kind: 'wander', nextHeadingAt: now + 500 };
        break;
      }
      tickOrbit(fairy, ptrTarget, dt);
      break;
    }
  }

  // Integrate position.
  fairy.pos.x += fairy.vel.x * dt;
  fairy.pos.y += fairy.vel.y * dt;

  // Smooth eyes after state logic (uses the latest fairy.heading).
  updateEyes(fairy, eyeTarget);
}

function tickWander(fairy: Fairy, dt: number, now: number, noise: NoiseFn, world: World, allFairies: Fairy[]): void {
  // Desired heading: Perlin noise of (pos, time, seed) → 0..1 → 0..TAU.
  const n = noise(fairy.pos.x * 0.002, fairy.pos.y * 0.002, now * 0.0005 + fairy.rngSeed * 0.001);
  let desired = n * TAU;

  // Fairy repulsion takes priority over edge avoidance.
  const repelBias = fairyRepelBias(fairy, allFairies);
  if (repelBias !== null) {
    desired = repelBias;
  } else {
    const bias = edgeAvoidBias(fairy, world);
    if (bias !== null) desired = bias;
  }

  steerHeading(fairy, desired, dt);

  // Speed with small sin modulation.
  const speed = WANDER_SPEED * (0.85 + 0.15 * Math.sin(now * 0.003 + fairy.rngSeed));
  fairy.vel.x = Math.cos(fairy.heading) * speed;
  fairy.vel.y = Math.sin(fairy.heading) * speed;
}

// Returns the point STANDOFF_DIST px from ptr in the direction from ptr → fairy.
function computeStandoff(fairyPos: Vec2, ptr: Vec2): Vec2 {
  const dx = fairyPos.x - ptr.x;
  const dy = fairyPos.y - ptr.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: ptr.x + (dx / len) * STANDOFF_DIST,
    y: ptr.y + (dy / len) * STANDOFF_DIST,
  };
}

function tickApproach(fairy: Fairy, standoff: Vec2 | null, dt: number): void {
  if (!standoff) return;
  const dx = standoff.x - fairy.pos.x;
  const dy = standoff.y - fairy.pos.y;
  steerHeading(fairy, Math.atan2(dy, dx), dt);

  // Taper speed to zero as the fairy closes in on the standoff point.
  const distToStandoff = Math.hypot(dx, dy);
  const brakeFactor = Math.min(1, distToStandoff / APPROACH_BRAKE_DIST);
  const currentSpeed = Math.hypot(fairy.vel.x, fairy.vel.y);
  const targetSpeed = APPROACH_SPEED * brakeFactor;
  const nextSpeed = currentSpeed + (targetSpeed - currentSpeed) * Math.min(1, dt * 3);
  fairy.vel.x = Math.cos(fairy.heading) * nextSpeed;
  fairy.vel.y = Math.sin(fairy.heading) * nextSpeed;
}

// Orbit the cursor at a radius that breathes in and out organically.
// Two overlapping sines (phase and 1.7× phase) with different weights so the
// combined waveform never perfectly repeats, giving a natural "closer / farther"
// rhythm. Both are zero at phase=0 so the orbit radius starts exactly at
// ORBIT_RADIUS_BASE (≈ where the approach left off) and drifts from there.
function tickOrbit(fairy: Fairy, ptr: Vec2, dt: number): void {
  const fsm = fairy.fsm as Extract<FSMState, { kind: 'orbit' }>;

  // Advance orbit angle and radius phase.
  fsm.orbitAngle += ORBIT_ANGULAR_SPEED * dt * fsm.orbitDir;
  fsm.orbitPhase += ORBIT_PHASE_SPEED * dt;

  // Compute current orbit radius.
  const r = ORBIT_RADIUS_BASE
    + ORBIT_RADIUS_VARIANCE       * Math.sin(fsm.orbitPhase)
    + ORBIT_RADIUS_VARIANCE * 0.5 * Math.sin(fsm.orbitPhase * 1.7);

  // Orbit target: point on the varying circle around the cursor.
  const targetX = ptr.x + Math.cos(fsm.orbitAngle) * r;
  const targetY = ptr.y + Math.sin(fsm.orbitAngle) * r;

  // Steer heading toward orbit target.
  const dx = targetX - fairy.pos.x;
  const dy = targetY - fairy.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.5) steerHeading(fairy, Math.atan2(dy, dx), dt);

  // Smoothly ramp speed up to ORBIT_SPEED (handles near-stopped orbit entry).
  const currentSpeed = Math.hypot(fairy.vel.x, fairy.vel.y);
  const nextSpeed = currentSpeed + (ORBIT_SPEED - currentSpeed) * Math.min(1, dt * 4);
  fairy.vel.x = Math.cos(fairy.heading) * nextSpeed;
  fairy.vel.y = Math.sin(fairy.heading) * nextSpeed;
}
