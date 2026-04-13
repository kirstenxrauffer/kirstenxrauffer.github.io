// p5 instance-mode sketch factory for the fairies feature.
// Isolated from React: takes no props; reads its singletons from the
// pointer module. The factory is returned by makeSketch() so FairyCanvas
// can hand it to `new p5(factory, host)`.

import type p5 from 'p5';
import * as brush from 'p5.brush';
import type { Fairy } from './fairy/fairy.types';
import { createFairy } from './fairy/fairy.factory';
import { drawFairy } from './fairy/fairy.draw';
import { computeDetectRadius, CANONICAL_CX, CANONICAL_CY, EYE_A, EYE_B, EYE_SIZES, BACK_WING, FRONT_WING } from './fairy/constants';
import { drawWing } from './fairy/wings';
import { drawPupil, drawSclera } from './fairy/eyes';
import { tickFairy } from './behavior/behavior.fsm';
import { registerBrushes } from './brush/brushSetup';
import { pointer } from './input/pointer';
import { addPollenStamp, tickPollenTrail, drawPollenTrail } from './pollen';

const INITIAL_FAIRY_COUNT = 1;

export type SketchCallbacks = {
  /** Called when the pointer enters or leaves hover range of any fairy. */
  onHoverChange?: (isHovering: boolean) => void;
  /** Called every draw frame with the first fairy's position in screen pixels. */
  onPositionChange?: (x: number, y: number) => void;
};

export function makeSketch(callbacks: SketchCallbacks = {}): (p: p5) => void {
  return (p: p5) => {
    let fairies: Fairy[] = [];
    let prevHoverState = false;
    // Bind p.noise once so the FSM can receive a pure (x,y,z) => number.
    const noise = (x: number, y: number, z: number) => p.noise(x, y, z);

    // p5.brush registers for instance mode via brush.instance(p).
    // Must be called BEFORE setup per p5.brush docs.
    brush.instance(p);

    p.setup = () => {
      p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
      p.pixelDensity(p.displayDensity());
      registerBrushes();
      fairies = spawnInitialFairies(p);
    };

    p.windowResized = () => {
      p.resizeCanvas(p.windowWidth, p.windowHeight, true);
    };

    p.draw = () => {
      p.clear();

      // Translate so (0,0) is top-left (WEBGL default is centre).
      p.translate(-p.width / 2, -p.height / 2);

      const now = p.millis();
      // Clamp dt to 50ms so a background-tab return doesn't teleport fairies.
      const dt = Math.min(p.deltaTime / 1000, 0.05);
      const R = computeDetectRadius(p.width);
      const world = { w: p.width, h: p.height };

      // Pollen trail — spawn stamp if pointer is moving, then draw.
      // Drawn BEFORE fairies so fairies render on top.
      if (pointer.seen) { addPollenStamp(pointer.x, pointer.y, now); }
      tickPollenTrail(now);
      drawPollenTrail(p, now);

      for (const fairy of fairies) {
        tickFairy({ fairy, pointer, dt, detectRadius: R, now, noise, world, allFairies: fairies });
      }
      let anyHovered = false;
      for (const fairy of fairies) {
        const facingRight = pointer.seen && pointer.x > fairy.pos.x;

        // Smooth wing rotation: lerp wingFlipT toward 0 or 1 each frame.
        const flipTarget = facingRight ? 1 : 0;
        fairy.wingFlipT += (flipTarget - fairy.wingFlipT) * Math.min(1, 12 * dt);
        // Eye size cross-fade uses a separate, slower lerp so the eyes take longer
        // to swap than the wings — makes the direction change feel more organic.
        fairy.eyeFlipT  += (flipTarget - fairy.eyeFlipT)  * Math.min(1,  3 * dt);

        // cos(wingFlipT * π) goes 1 → 0 → -1, compressing the wings like a
        // 3D Y-axis rotation. The x-offset interpolates between the two endpoints.
        const wingCosT = Math.cos(fairy.wingFlipT * Math.PI);
        // Facing-left offset (wingFlipT=0) shifts wings left; facing-right offset
        // (wingFlipT=1) shifts wings right. Both are in local units before fairy.scale.
        const WING_X_LEFT  = -25;  // local units when facing left
        const WING_X_RIGHT = -15;  // local units when facing right
        const wingXShift = WING_X_LEFT + fairy.wingFlipT * (WING_X_RIGHT - WING_X_LEFT);

        // Hover: pointer within 80 px of the fairy's world centre.
        const hoverDist = pointer.seen
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
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spawnInitialFairies(p: p5): Fairy[] {
  const out: Fairy[] = [];
  for (let i = 0; i < INITIAL_FAIRY_COUNT; i++) {
    // Spawn on the left or right wing of the screen so the fairy doesn't
    // start in the center text zone.
    const spawnLeft = p.random() > 0.5;
    out.push(
      createFairy({
        id: `fairy-${i}`,
        pos: {
          x: spawnLeft
            ? p.random(p.width * 0.05, p.width * 0.20)
            : p.random(p.width * 0.80, p.width * 0.95),
          y: p.random(p.height * 0.1, p.height * 0.9),
        },
        heading: p.random(0, Math.PI * 2),
        rngSeed: Math.floor(p.random(1, 1e9)),
      }),
    );
  }
  return out;
}

export function drawEyes(p: p5, fairies: Fairy[]): void {
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
