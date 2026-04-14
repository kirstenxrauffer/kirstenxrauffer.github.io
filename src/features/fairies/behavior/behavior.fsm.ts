// Pure FSM tick for fairies. No p5 imports — takes a noise function instead
// so it remains trivially unit-testable.
//
// FSM:
//   WANDER -(ptr seen)-> APPROACH -(at standoff)-> ORBIT -(ptr lost)-> WANDER
//   Any state -(nav opens)-> FLEE -(safe distance reached)-> WANDER
//
// The fairy pursues the live cursor. In APPROACH it targets a standoff point
// STANDOFF_DIST px from the cursor (toward itself), braking as it arrives.
// On arrival it enters ORBIT, continuously circling the cursor at a radius
// that breathes in and out via two overlapping sines — creating the
// "sometimes getting closer, then pulling back" feel.
//
// FLEE: when the nav menu opens the fairy flies ~220 px away from the nav
// panel (opposite direction) then wanders, biased away from the nav area
// until the menu closes.
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
  FLEE_SPEED,
  FLEE_ARRIVAL_DIST,
  NAV_AVOID_RADIUS,
  CENTER_AVOID_RX_FRAC,
  CENTER_AVOID_RY_FRAC,
  NAV_ORBIT_ANG_SPEED,
  NAV_ORBIT_REVOLUTIONS,
  GAME_APPROACH_SPEED,
  GAME_APPROACH_ARRIVE,
  GAME_HOVER_RADIUS_BASE,
  GAME_HOVER_RADIUS_VARIANCE,
  GAME_HOVER_ANG_SPEED,
  GAME_HOVER_PHASE_SPEED,
  GAME_HOVER_SPEED,
  GAME_HOVER_TRAVEL_SPEED,
  ANGRY_SHAKE_HZ,
  ANGRY_SHAKE_AMP,
  ANGRY_DURATION_MS,
  CELEBRATE_LAP_SPEED,
  CELEBRATE_LAP_INSET,
} from '../fairy/constants';
import type { Pointer } from '../input/pointer';
import { navArea } from '../navArea';

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

// ─── Nav-flee helpers ─────────────────────────────────────────────────────────

/**
 * Which side of the screen has the most space around the nav click point.
 * Mirrors bestNavSide in NavMenu.tsx so the FSM and React agree on nav direction.
 */
function computeNavSide(world: World): 'left' | 'right' | 'top' | 'bottom' {
  const spaces = {
    right:  world.w - navArea.clickX,
    left:   navArea.clickX,
    bottom: world.h - navArea.clickY,
    top:    navArea.clickY,
  };
  return (Object.keys(spaces) as Array<keyof typeof spaces>)
    .reduce((a, b) => spaces[a] >= spaces[b] ? a : b);
}

/**
 * Safe destination ~220 px from the nav in the direction opposite the nav panel
 * (e.g. nav appears right of navi → flee left).
 */
function computeFleeTarget(world: World): Vec2 {
  const side = computeNavSide(world);
  const FLEE_DIST = 220;
  let fx = navArea.clickX;
  let fy = navArea.clickY;
  switch (side) {
    case 'right':  fx -= FLEE_DIST; break;
    case 'left':   fx += FLEE_DIST; break;
    case 'bottom': fy -= FLEE_DIST; break;
    case 'top':    fy += FLEE_DIST; break;
  }
  return {
    x: Math.max(60, Math.min(world.w - 60, fx)),
    y: Math.max(60, Math.min(world.h - 60, fy)),
  };
}

/** Soft repel while wandering near the nav area. */
function navAreaRepelBias(fairy: Fairy): number | null {
  if (!navArea.active) return null;
  const dx = fairy.pos.x - navArea.clickX;
  const dy = fairy.pos.y - navArea.clickY;
  const dist = Math.hypot(dx, dy);
  if (dist >= NAV_AVOID_RADIUS || dist < 0.5) return null;
  return Math.atan2(dy, dx);
}

/**
 * Steer away from the centre-screen content ellipse while wandering.
 * Activates when the fairy's normalised ellipse distance drops below
 * SOFT_MARGIN (i.e. inside the ellipse or within ~50% of its boundary).
 * Has no effect during APPROACH or ORBIT so the fairy still chases the cursor.
 */
function centerAvoidBias(fairy: Fairy, world: World): number | null {
  const cx = world.w / 2;
  const cy = world.h / 2;
  const rx = world.w * CENTER_AVOID_RX_FRAC;
  const ry = world.h * CENTER_AVOID_RY_FRAC;

  const dx = fairy.pos.x - cx;
  const dy = fairy.pos.y - cy;

  // Normalised ellipse distance: <1 = inside, 1 = on boundary, >1 = outside.
  const normDist = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);

  // Bias activates within a 50% soft margin outside the hard ellipse boundary.
  const SOFT_MARGIN = 1.5;
  if (normDist >= SOFT_MARGIN || normDist < 0.001) return null;

  // Steer directly away from the centre of the ellipse.
  return Math.atan2(dy, dx);
}

// ─── NavOrbit helpers ─────────────────────────────────────────────────────────

/**
 * NavOrbit ticks: navi orbits the nav-container's bounding circle ONCE at
 * half speed. Phase 'travel' smoothsteps the centre from navi's starting
 * position toward the container centre while orbitAngle advances, producing
 * one continuous swirl into the ring. Phase 'orbit' circles the container at
 * fsm.radius. After NAV_ORBIT_REVOLUTIONS turns, sets navArea.gamePromptOpen
 * and hands off to gameApproach.
 */
function tickNavOrbit(fairy: Fairy, dt: number): boolean {
  const fsm = fairy.fsm as Extract<FSMState, { kind: 'navOrbit' }>;

  // Only advance the orbit angle once we've arrived at the container.
  // During 'travel', holding orbitAngle fixed means the target point is just
  // `center + (cos,sin) * radius` with a smoothly lerping center — a clean arc
  // into the entry point instead of a spiral chasing a rotating target.
  const angStep = fsm.phase === 'orbit'
    ? NAV_ORBIT_ANG_SPEED * dt * fsm.orbitDir
    : 0;
  fsm.orbitAngle += angStep;

  let cx: number;
  let cy: number;
  let centerSpeed = 0;
  if (fsm.phase === 'travel') {
    fsm.travelT = Math.min(1, fsm.travelT + dt / fsm.travelDuration);
    const e = fsm.travelT * fsm.travelT * (3 - 2 * fsm.travelT);
    cx = fsm.travelFrom.x + (fsm.center.x - fsm.travelFrom.x) * e;
    cy = fsm.travelFrom.y + (fsm.center.y - fsm.travelFrom.y) * e;
    const segDist = Math.hypot(
      fsm.center.x - fsm.travelFrom.x,
      fsm.center.y - fsm.travelFrom.y,
    );
    centerSpeed = segDist / fsm.travelDuration;
    if (fsm.travelT >= 1) {
      fsm.phase = 'orbit';
      fsm.orbitTurn = 0;
    }
  } else {
    cx = fsm.center.x;
    cy = fsm.center.y;
    fsm.orbitTurn += Math.abs(angStep);
    if (fsm.orbitTurn >= NAV_ORBIT_REVOLUTIONS * Math.PI * 2) {
      return true; // done — caller will transition to gameApproach
    }
  }

  const targetX = cx + Math.cos(fsm.orbitAngle) * fsm.radius;
  const targetY = cy + Math.sin(fsm.orbitAngle) * fsm.radius;
  const dx = targetX - fairy.pos.x;
  const dy = targetY - fairy.pos.y;
  const distToTarget = Math.hypot(dx, dy);

  if (fsm.phase === 'travel') {
    // Fly STRAIGHT at the entry point. Using a heading-based steer with a
    // capped turn rate made navi arc for ~0.3s while rotating, which read as
    // a weird curved approach. Velocity toward target + a fast heading snap
    // keeps the path a clean dart while the sprite still faces forward.
    const desired = distToTarget > 0.5 ? Math.atan2(dy, dx) : fairy.heading;
    const diff = angleDiff(desired, fairy.heading);
    const maxStep = 24 * dt; // ~1.3 rad in a single frame at 60fps
    fairy.heading += Math.max(-maxStep, Math.min(maxStep, diff));
    if (distToTarget > 0.5) {
      fairy.vel.x = (dx / distToTarget) * centerSpeed;
      fairy.vel.y = (dy / distToTarget) * centerSpeed;
    } else {
      fairy.vel.x = 0;
      fairy.vel.y = 0;
    }
  } else {
    if (distToTarget > 0.5) {
      const desired = Math.atan2(dy, dx);
      const diff = angleDiff(desired, fairy.heading);
      const maxStep = 10 * dt;
      fairy.heading += Math.max(-maxStep, Math.min(maxStep, diff));
    }
    const speed = NAV_ORBIT_ANG_SPEED * fsm.radius;
    fairy.vel.x = Math.cos(fairy.heading) * speed;
    fairy.vel.y = Math.sin(fairy.heading) * speed;
  }
  return false;
}

/** Fly toward the live cursor. Returns true when within arrival distance. */
function tickGameApproach(fairy: Fairy, pointer: Pointer, dt: number): boolean {
  if (!pointer.seen) return false;
  const dx = pointer.x - fairy.pos.x;
  const dy = pointer.y - fairy.pos.y;
  const dist = Math.hypot(dx, dy);
  steerHeading(fairy, Math.atan2(dy, dx), dt);
  const brakeFactor = Math.max(0.15, Math.min(1, dist / APPROACH_BRAKE_DIST));
  const targetSpeed = GAME_APPROACH_SPEED * brakeFactor;
  const currentSpeed = Math.hypot(fairy.vel.x, fairy.vel.y);
  const nextSpeed = currentSpeed + (targetSpeed - currentSpeed) * Math.min(1, dt * 4);
  fairy.vel.x = Math.cos(fairy.heading) * nextSpeed;
  fairy.vel.y = Math.sin(fairy.heading) * nextSpeed;
  return dist < GAME_APPROACH_ARRIVE;
}

/**
 * Hold position while the game menu is up — navi freezes wherever she arrived
 * at the end of gameApproach. Velocity is damped to zero; position is left
 * untouched so the tooltip anchor stays stable.
 */
function tickGameIdle(fairy: Fairy, _pointer: Pointer, dt: number): void {
  const fsm = fairy.fsm as Extract<FSMState, { kind: 'gameIdle' }>;
  fairy.vel.x = 0;
  fairy.vel.y = 0;
  // Snap gently back to anchor so integration in the caller stays a no-op.
  fairy.pos.x += (fsm.anchor.x - fairy.pos.x) * Math.min(1, dt * 10);
  fairy.pos.y += (fsm.anchor.y - fairy.pos.y) * Math.min(1, dt * 10);
}

/**
 * Light orbit around the "you" label while a card game is active. Anchor is
 * read live from navArea each tick so navi tracks scroll / resize. When she's
 * far from the anchor (e.g. just entered the state), speed scales up so she
 * migrates into the hover ring; once inside she settles into a slow circle
 * with a breathing radius.
 */
function tickGameHover(fairy: Fairy, dt: number, anchor: Vec2): void {
  const fsm = fairy.fsm as Extract<FSMState, { kind: 'gameHover' }>;
  fsm.orbitAngle += GAME_HOVER_ANG_SPEED * dt;
  fsm.orbitPhase += GAME_HOVER_PHASE_SPEED * dt;

  const r = GAME_HOVER_RADIUS_BASE
    + GAME_HOVER_RADIUS_VARIANCE       * Math.sin(fsm.orbitPhase)
    + GAME_HOVER_RADIUS_VARIANCE * 0.5 * Math.sin(fsm.orbitPhase * 1.7);

  const targetX = anchor.x + Math.cos(fsm.orbitAngle) * r;
  const targetY = anchor.y + Math.sin(fsm.orbitAngle) * r;
  const dx = targetX - fairy.pos.x;
  const dy = targetY - fairy.pos.y;
  if (dx * dx + dy * dy > 0.25) steerHeading(fairy, Math.atan2(dy, dx), dt);

  const distToAnchor = Math.hypot(fairy.pos.x - anchor.x, fairy.pos.y - anchor.y);
  const farFactor = Math.min(1, Math.max(0, (distToAnchor - r) / 140));
  const desired = GAME_HOVER_SPEED + (GAME_HOVER_TRAVEL_SPEED - GAME_HOVER_SPEED) * farFactor;
  const current = Math.hypot(fairy.vel.x, fairy.vel.y);
  const next = current + (desired - current) * Math.min(1, dt * 4);
  fairy.vel.x = Math.cos(fairy.heading) * next;
  fairy.vel.y = Math.sin(fairy.heading) * next;
}

/**
 * Angry shake — navi hovers in place while a cosine-based horizontal shake
 * is written directly to fairy.pos every frame. Anchor is the position at
 * state entry; the shake is additive around it.
 */
function tickAngry(fairy: Fairy, dt: number, now: number): void {
  const fsm = fairy.fsm as Extract<FSMState, { kind: 'angry' }>;
  const elapsedMs = now - fsm.startedAt;
  // Timeout: clear the React-owned mood so the next tick transitions back to
  // wander via the mood override block. sketch.ts copies navArea.currentMood
  // onto fairy.mood every frame, so mutating fairy.mood here would be stomped.
  if (elapsedMs >= ANGRY_DURATION_MS && navArea.currentMood === 'angry') {
    navArea.currentMood = 'normal';
  }
  const t = elapsedMs / 1000;
  const shake = Math.sin(t * ANGRY_SHAKE_HZ * Math.PI * 2) * ANGRY_SHAKE_AMP;
  // Zero velocity so the post-switch integration does nothing — we set pos
  // directly here each frame.
  fairy.vel.x = 0;
  fairy.vel.y = 0;
  fairy.pos.x = fsm.anchor.x + shake;
  fairy.pos.y += (fsm.anchor.y - fairy.pos.y) * Math.min(1, dt * 6);
}

/**
 * Victory lap — navi circles the viewport perimeter on an inset ellipse.
 * Pollen is emitted by sketch.ts when this state is active.
 */
function tickCelebrate(fairy: Fairy, dt: number, world: World): void {
  const fsm = fairy.fsm as Extract<FSMState, { kind: 'celebrate' }>;
  const cx = world.w / 2;
  const cy = world.h / 2;
  const rx = Math.max(100, world.w / 2 - CELEBRATE_LAP_INSET);
  const ry = Math.max(100, world.h / 2 - CELEBRATE_LAP_INSET);
  // Advance at roughly constant linear speed: angular speed scales with
  // path radius at current angle. Approximation: use geometric mean.
  const r = Math.sqrt(rx * ry);
  fsm.angle += (CELEBRATE_LAP_SPEED / r) * dt;
  const targetX = cx + Math.cos(fsm.angle) * rx;
  const targetY = cy + Math.sin(fsm.angle) * ry;
  const dx = targetX - fairy.pos.x;
  const dy = targetY - fairy.pos.y;
  if (dx * dx + dy * dy > 0.25) {
    const desired = Math.atan2(dy, dx);
    const diff = angleDiff(desired, fairy.heading);
    const maxStep = 12 * dt;
    fairy.heading += Math.max(-maxStep, Math.min(maxStep, diff));
  }
  fairy.vel.x = Math.cos(fairy.heading) * CELEBRATE_LAP_SPEED;
  fairy.vel.y = Math.sin(fairy.heading) * CELEBRATE_LAP_SPEED;
}

// ─── Flee helpers ─────────────────────────────────────────────────────────────

/** Fly toward fsm.targetPos at FLEE_SPEED, braking as navi closes in. */
function tickFlee(fairy: Fairy, dt: number): void {
  const fsm = fairy.fsm as Extract<FSMState, { kind: 'flee' }>;
  const dx = fsm.targetPos.x - fairy.pos.x;
  const dy = fsm.targetPos.y - fairy.pos.y;
  steerHeading(fairy, Math.atan2(dy, dx), dt);
  const distToTarget = Math.hypot(dx, dy);
  // Floor at 0.25 so navi doesn't freeze just before the target.
  const brakeFactor = Math.max(0.25, Math.min(1, distToTarget / APPROACH_BRAKE_DIST));
  const targetSpeed = FLEE_SPEED * brakeFactor;
  const currentSpeed = Math.hypot(fairy.vel.x, fairy.vel.y);
  const nextSpeed = currentSpeed + (targetSpeed - currentSpeed) * Math.min(1, dt * 4);
  fairy.vel.x = Math.cos(fairy.heading) * nextSpeed;
  fairy.vel.y = Math.sin(fairy.heading) * nextSpeed;
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Mood-driven state overrides — game end forces navi into win/lose state.
  if (fairy.mood === 'angry' && fairy.fsm.kind !== 'angry') {
    fairy.fsm = {
      kind: 'angry',
      startedAt: now,
      anchor: { x: fairy.pos.x, y: fairy.pos.y },
    };
  } else if (fairy.mood === 'celebrate' && fairy.fsm.kind !== 'celebrate') {
    const cx = world.w / 2;
    const cy = world.h / 2;
    const startAngle = Math.atan2(fairy.pos.y - cy, fairy.pos.x - cx);
    fairy.fsm = { kind: 'celebrate', angle: startAngle };
  } else if (fairy.mood === 'normal' && (fairy.fsm.kind === 'angry' || fairy.fsm.kind === 'celebrate')) {
    fairy.fsm = { kind: 'wander', nextHeadingAt: now + 200 };
  }

  // Dismiss game prompt → return to normal wander/approach behavior.
  if (navArea.dismissRequested) {
    navArea.dismissRequested = false;
    if (fairy.fsm.kind === 'gameIdle' || fairy.fsm.kind === 'gameApproach') {
      fairy.fsm = { kind: 'wander', nextHeadingAt: now + 200 };
    }
  }

  // Game active (anchor present): enter a light hover orbit around the "you"
  // label. Mood states take precedence — win/lose animations play out before
  // navi returns here. Not entered from flee so navi still completes her
  // escape from the nav menu if it's open for any reason.
  if (
    navArea.gameAnchor
    && !navArea.holdForPrompt
    && fairy.fsm.kind !== 'gameHover'
    && fairy.fsm.kind !== 'angry'
    && fairy.fsm.kind !== 'celebrate'
    && fairy.fsm.kind !== 'flee'
    && fairy.mood === 'normal'
  ) {
    fairy.fsm = { kind: 'gameHover', orbitAngle: Math.random() * TAU, orbitPhase: 0 };
  }
  // Game ended (anchor cleared) while still hovering → release to wander.
  if (!navArea.gameAnchor && fairy.fsm.kind === 'gameHover') {
    fairy.fsm = { kind: 'wander', nextHeadingAt: now + 200 };
  }

  // Prompt-hold request: navi freezes at her current position, emits pollen
  // (sketch.ts reads fsm.kind === 'gameIdle') and the prompt backdrop dims
  // the rest of the screen. No travel, no orbit — just a held moment.
  if (navArea.holdForPrompt && fairy.fsm.kind !== 'gameIdle') {
    fairy.fsm = {
      kind: 'gameIdle',
      anchor: { x: fairy.pos.x, y: fairy.pos.y },
    };
    // Tell React the prompt is up — FairyCanvas already sets setPromptOpen on
    // click, but this also drives any FSM-listening UI that relies on the flag.
    navArea.gamePromptOpen = true;
  }

  switch (fairy.fsm.kind) {
    case 'wander':
      eyeTarget = null;
      // Nav open: flee before wandering logic runs.
      if (navArea.active) {
        fairy.fsm = { kind: 'flee', targetPos: computeFleeTarget(world) };
        break;
      }
      tickWander(fairy, dt, now, noise, world, allFairies);
      // Transition to APPROACH immediately when pointer is seen — no pause.
      if (ptrTarget) {
        fairy.fsm = { kind: 'approach', target: { ...ptrTarget }, enteredAt: now };
      }
      break;

    case 'approach': {
      // Nav open: abort approach, flee.
      if (navArea.active) {
        fairy.fsm = { kind: 'flee', targetPos: computeFleeTarget(world) };
        break;
      }
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
      // Nav open: break orbit, flee.
      if (navArea.active) {
        fairy.fsm = { kind: 'flee', targetPos: computeFleeTarget(world) };
        break;
      }
      eyeTarget = ptrTarget;
      if (!ptrTarget) {
        fairy.fsm = { kind: 'wander', nextHeadingAt: now + 500 };
        break;
      }
      tickOrbit(fairy, ptrTarget, dt);
      break;
    }

    case 'flee': {
      const fsm = fairy.fsm as Extract<FSMState, { kind: 'flee' }>;
      eyeTarget = fsm.targetPos; // eyes track destination while fleeing
      if (!navArea.active) {
        // Nav closed — return to normal.
        fairy.fsm = { kind: 'wander', nextHeadingAt: now + 200 };
        break;
      }
      const distToTarget = Math.hypot(
        fairy.pos.x - fsm.targetPos.x,
        fairy.pos.y - fsm.targetPos.y,
      );
      if (distToTarget < FLEE_ARRIVAL_DIST) {
        // Reached safe spot — wander (nav-area repel keeps distance while open).
        fairy.fsm = { kind: 'wander', nextHeadingAt: now + 200 };
        break;
      }
      tickFlee(fairy, dt);
      break;
    }

    case 'navOrbit': {
      // Game-end moods take over even mid-orbit.
      const fsm = fairy.fsm as Extract<FSMState, { kind: 'navOrbit' }>;
      eyeTarget = fsm.center;
      const done = tickNavOrbit(fairy, dt);
      if (done) {
        // Signal React: close the nav menu and show the game prompt tooltip.
        navArea.gamePromptOpen = true;
        // Freeze in place — navi holds here until the prompt is dismissed
        // (click elsewhere) rather than chasing the cursor.
        fairy.fsm = {
          kind: 'gameIdle',
          anchor: { x: fairy.pos.x, y: fairy.pos.y },
        };
      }
      break;
    }

    case 'gameApproach': {
      eyeTarget = ptrTarget;
      const arrived = tickGameApproach(fairy, pointer, dt);
      if (arrived) {
        fairy.fsm = {
          kind: 'gameIdle',
          anchor: { x: fairy.pos.x, y: fairy.pos.y },
        };
      }
      break;
    }

    case 'gameIdle': {
      eyeTarget = ptrTarget;
      // Game result posted by React — transition handled by mood block above.
      if (navArea.gameStartRequested) {
        navArea.gameStartRequested = false;
        // Keep idling near cursor while the modal is up; mood will take over on end.
      }
      tickGameIdle(fairy, pointer, dt);
      break;
    }

    case 'gameHover': {
      const anchor = navArea.gameAnchor;
      if (!anchor) {
        fairy.fsm = { kind: 'wander', nextHeadingAt: now + 200 };
        break;
      }
      eyeTarget = ptrTarget ?? anchor;
      tickGameHover(fairy, dt, anchor);
      break;
    }

    case 'angry': {
      eyeTarget = ptrTarget;
      tickAngry(fairy, dt, now);
      break;
    }

    case 'celebrate': {
      eyeTarget = null;
      tickCelebrate(fairy, dt, world);
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

  // Priority: fairy repulsion > center avoidance > nav-area avoidance > edge avoidance > noise.
  const repelBias = fairyRepelBias(fairy, allFairies);
  if (repelBias !== null) {
    desired = repelBias;
  } else {
    const centerBias = centerAvoidBias(fairy, world);
    if (centerBias !== null) {
      desired = centerBias;
    } else {
      const navBias = navAreaRepelBias(fairy);
      if (navBias !== null) {
        desired = navBias;
      } else {
        const bias = edgeAvoidBias(fairy, world);
        if (bias !== null) desired = bias;
      }
    }
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
// Two overlapping sines (phase and 1.7x phase) with different weights so the
// combined waveform never perfectly repeats, giving a natural "closer / farther"
// rhythm. Both are zero at phase=0 so the orbit radius starts exactly at
// ORBIT_RADIUS_BASE (where the approach left off) and drifts from there.
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
