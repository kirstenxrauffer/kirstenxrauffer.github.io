// Fairy sketch runtime.
//
// Previously a p5 instance-mode sketch. p5 cost 1,103 kB raw / 322 kB gzipped —
// over half the site's JavaScript — to provide filled circles, a transform
// stack, and one call to Perlin noise. Those now come from render/painter.ts and
// render/noise.ts, and this module owns the canvas and the animation loop
// directly. The draw code below is otherwise unchanged.
//
// The old sketch created a WEBGL canvas and then immediately did
// translate(-width/2, -height/2) to undo p5's centred WEBGL origin. Canvas 2D
// already has a top-left origin, so that correction is gone.

import type { Fairy } from './fairy/fairy.types';
import { createFairy } from './fairy/fairy.factory';
import { drawFairy, clearGlowSprites } from './fairy/fairy.draw';
import { computeDetectRadius, CANONICAL_CX, CANONICAL_CY, EYE_A, EYE_B, EYE_SIZES, BACK_WING, FRONT_WING } from './fairy/constants';
import { drawWing, clearWingSprites } from './fairy/wings';
import { drawPupil, drawSclera, clearEyeSprites } from './fairy/eyes';
import { tickFairy } from './behavior/behavior.fsm';
import { pointer } from './input/pointer';
import { addPollenStamp, addFairyPollenStamp, tickPollenTrail, drawPollenTrail } from './pollen';
import { navArea } from './navArea';
import { createCanvasPainter, type Painter } from './render/painter';
import { noise } from './render/noise';

const INITIAL_FAIRY_COUNT = 1;

export type SketchCallbacks = {
  /** Called when the pointer enters or leaves hover range of any fairy. */
  onHoverChange?: (isHovering: boolean) => void;
  /** Called every draw frame with the first fairy's position in screen pixels. */
  onPositionChange?: (x: number, y: number) => void;
};

export type FairySketch = { destroy(): void };

/** p5's random(): no args → [0,1), one arg → [0,a), two → [a,b). */
function rand(a?: number, b?: number): number {
  if (a === undefined) return Math.random();
  if (b === undefined) return Math.random() * a;
  return a + Math.random() * (b - a);
}

export function createFairySketch(host: HTMLElement, callbacks: SketchCallbacks = {}): FairySketch {
  const surface = createCanvasPainter(window.innerWidth, window.innerHeight);
  surface.canvas.style.display = 'block';
  host.appendChild(surface.canvas);

  const p: Painter = surface.painter;
  let fairies: Fairy[] = spawnInitialFairies(surface.width, surface.height);
  let prevHoverState = false;

  const startTime = performance.now();
  let lastFrame = startTime;
  let raf = 0;
  let disposed = false;

  const onResize = () => {
    surface.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  const draw = () => {
    if (disposed) return;
    raf = requestAnimationFrame(draw);

    surface.clear();

    const nowAbs = performance.now();
    const now = nowAbs - startTime;
    // Clamp dt to 50ms so a background-tab return doesn't teleport fairies.
    const dt = Math.min((nowAbs - lastFrame) / 1000, 0.05);
    lastFrame = nowAbs;

    const R = computeDetectRadius(surface.width);
    const world = { w: surface.width, h: surface.height };

    // Pollen trail — spawn stamp if pointer is moving, then draw.
    // Drawn BEFORE fairies so fairies render on top.
    if (pointer.seen) { addPollenStamp(pointer.x, pointer.y, now); }
    tickPollenTrail(now);
    drawPollenTrail(p, now);

    for (const fairy of fairies) {
      // Pull mood from the navArea singleton each frame so React-driven
      // game-end signals surface through the FSM.
      fairy.mood = navArea.currentMood;
      tickFairy({ fairy, pointer, dt, detectRadius: R, now, noise, world, allFairies: fairies });
      // Emit pollen while navi is holding for the game prompt OR doing her
      // victory lap.
      if (
        fairy.fsm.kind === 'navOrbit' ||
        fairy.fsm.kind === 'celebrate' ||
        fairy.fsm.kind === 'gameIdle'
      ) {
        addFairyPollenStamp(fairy.pos.x, fairy.pos.y, now);
      }
    }

    let anyHovered = false;
    for (const fairy of fairies) {
      // During navOrbit, freeze facing — orbital velocity.x flips sign twice
      // per revolution, so pointer-tracking OR velocity-tracking would both
      // rapidly flap the wings. Locking wingFlipT/eyeFlipT at their current
      // values keeps navi oriented while she circles the buttons.
      if (fairy.fsm.kind !== 'navOrbit') {
        const facingRight = pointer.seen && pointer.x > fairy.pos.x;
        const flipTarget = facingRight ? 1 : 0;
        // Smooth wing rotation: lerp wingFlipT toward 0 or 1 each frame.
        fairy.wingFlipT += (flipTarget - fairy.wingFlipT) * Math.min(1, 12 * dt);
        // Eye size cross-fade uses a separate, slower lerp so the eyes take
        // longer to swap than the wings — makes the direction change feel
        // more organic.
        fairy.eyeFlipT  += (flipTarget - fairy.eyeFlipT)  * Math.min(1,  3 * dt);
      }

      // cos(wingFlipT * π) goes 1 → 0 → -1, compressing the wings like a
      // 3D Y-axis rotation. The x-offset interpolates between the two endpoints.
      const wingCosT = Math.cos(fairy.wingFlipT * Math.PI);
      const WING_X_LEFT  = -25;  // local units when facing left
      const WING_X_RIGHT = -15;  // local units when facing right
      const wingXShift = WING_X_LEFT + fairy.wingFlipT * (WING_X_RIGHT - WING_X_LEFT);

      // Hover: pointer within 80 px of the fairy's world centre. Disabled during
      // navOrbit so it doesn't jitter or re-trigger the click-to-close path.
      const hoverDist = (pointer.seen && fairy.fsm.kind !== 'navOrbit')
        ? Math.hypot(pointer.x - fairy.pos.x, pointer.y - fairy.pos.y)
        : Infinity;
      // Ramp hoverT linearly (300 ms) so hover effects never jump abruptly.
      const HOVER_RAMP = 1 / 0.3;
      if (hoverDist < 80) anyHovered = true;
      fairy.hoverT = hoverDist < 80
        ? Math.min(1, fairy.hoverT + dt * HOVER_RAMP)
        : Math.max(0, fairy.hoverT - dt * HOVER_RAMP);

      // 1. Body glow — behind both wings
      drawFairy(p, fairy, now, fairy.hoverT);

      // 2. Back wing
      p.push();
      p.translate(fairy.pos.x, fairy.pos.y);
      p.scale(fairy.scale);
      p.translate(-CANONICAL_CX, -CANONICAL_CY);
      p.translate(wingXShift, 0); p.scale(wingCosT, 1);
      drawWing(p, fairy, BACK_WING);
      p.pop();

      // 3. Front wing — on top of back wing
      p.push();
      p.translate(fairy.pos.x, fairy.pos.y);
      p.scale(fairy.scale);
      p.translate(-CANONICAL_CX, -CANONICAL_CY);
      p.translate(wingXShift, 0); p.scale(wingCosT, 1);
      drawWing(p, fairy, FRONT_WING);
      p.pop();
    }

    if (anyHovered !== prevHoverState) {
      prevHoverState = anyHovered;
      callbacks.onHoverChange?.(anyHovered);
    }
    drawEyes(p, fairies);
    if (fairies.length > 0) {
      callbacks.onPositionChange?.(fairies[0].pos.x, fairies[0].pos.y);
    }
  };

  raf = requestAnimationFrame(draw);

  return {
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      surface.canvas.remove();
      clearWingSprites();
      clearGlowSprites();
      clearEyeSprites();
      fairies = [];
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spawnInitialFairies(width: number, height: number): Fairy[] {
  const out: Fairy[] = [];
  for (let i = 0; i < INITIAL_FAIRY_COUNT; i++) {
    // Spawn on the left or right wing of the screen so the fairy doesn't
    // start in the center text zone.
    const spawnLeft = rand() > 0.5;
    out.push(
      createFairy({
        id: `fairy-${i}`,
        pos: {
          x: spawnLeft
            ? rand(width * 0.05, width * 0.20)
            : rand(width * 0.80, width * 0.95),
          y: rand(height * 0.1, height * 0.9),
        },
        heading: rand(0, Math.PI * 2),
        rngSeed: Math.floor(rand(1, 1e9)),
      }),
    );
  }
  return out;
}

export function drawEyes(p: Painter, fairies: Fairy[]): void {
  for (const fairy of fairies) {
    // eyeFlipT=1 means cursor is to the RIGHT → fairy faces RIGHT.
    const t = fairy.eyeFlipT;
    const sA = EYE_SIZES.A.scleraR, pA = EYE_SIZES.A.pupilR;
    const sB = EYE_SIZES.B.scleraR, pB = EYE_SIZES.B.pupilR;

    const eyeASpec = {
      ...EYE_A,
      sclera: sA + (sB - sA) * t,
      pupilR: pA + (pB - pA) * t,
      maxR: Math.max(0, (sA + (sB - sA) * t) / 2 - (pA + (pB - pA) * t) / 2 - 5) * 0.9,
    };
    const eyeBSpec = {
      ...EYE_B,
      sclera: sB + (sA - sB) * t,
      pupilR: pB + (pA - pB) * t,
      maxR: Math.max(0, (sB + (sA - sB) * t) / 2 - (pB + (pA - pB) * t) / 2 - 5) * 0.9,
    };

    p.push();
    p.translate(fairy.pos.x, fairy.pos.y);
    p.scale(fairy.scale);
    p.translate(-CANONICAL_CX, -CANONICAL_CY);

    // When facing left (t<0.5) EYE_A is smaller (back), EYE_B is bigger (front) → draw A under B.
    // When facing right (t≥0.5) EYE_A is bigger (front), EYE_B is smaller (back) → draw B under A.
    // The swap happens at t=0.5 when both eyes are equal size, so it's imperceptible.
    if (t < 0.5) {
      drawSclera(p, eyeASpec);
      drawPupil(p, fairy, eyeASpec, fairy.eyeA);
      drawSclera(p, eyeBSpec);
      drawPupil(p, fairy, eyeBSpec, fairy.eyeB);
    } else {
      drawSclera(p, eyeBSpec);
      drawPupil(p, fairy, eyeBSpec, fairy.eyeB);
      drawSclera(p, eyeASpec);
      drawPupil(p, fairy, eyeASpec, fairy.eyeA);
    }

    p.pop();
  }
}
