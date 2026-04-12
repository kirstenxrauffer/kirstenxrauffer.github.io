// p5 instance-mode sketch factory for the bees feature.
// Isolated from React: takes no props; reads its singletons from the
// pointer module. The factory is returned by makeSketch() so BeeCanvas
// can hand it to `new p5(factory, host)`.

import type p5 from 'p5';
import * as brush from 'p5.brush';
import type { Bee } from './fairies/fairy/fairy.types';
import { createBee } from './fairies/fairy/fairy.factory';
import { drawBee } from './fairies/fairy/fairy.draw';
import { computeDetectRadius, CANONICAL_CX, CANONICAL_CY, CANONICAL_W, EYE_A, EYE_B, BACK_WING, FRONT_WING } from './bee/constants';
import { drawWing } from './fairies/fairy/wings';
import { drawPupil, drawSclera } from './fairies/fairy/eyes';
import { tickBee } from './behavior/behavior.fsm';
import { registerBrushes } from './brush/brushSetup';
import { pointer } from './input/pointer';
import { addPollenStamp, tickPollenTrail, drawPollenTrail } from './pollen';

const INITIAL_BEE_COUNT = 1;

export function makeSketch(): (p: p5) => void {
  return (p: p5) => {
    let bees: Bee[] = [];
    // Bind p.noise once so the FSM can receive a pure (x,y,z) => number.
    const noise = (x: number, y: number, z: number) => p.noise(x, y, z);

    // p5.brush registers for instance mode via brush.instance(p).
    // Must be called BEFORE setup per p5.brush docs.
    brush.instance(p);

    p.setup = () => {
      p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
      p.pixelDensity(p.displayDensity());
      registerBrushes();
      bees = spawnInitialBees(p);
    };

    p.windowResized = () => {
      p.resizeCanvas(p.windowWidth, p.windowHeight, true);
    };

    p.draw = () => {
      p.clear();

      // Translate so (0,0) is top-left (WEBGL default is centre).
      p.translate(-p.width / 2, -p.height / 2);

      const now = p.millis();
      // Clamp dt to 50ms so a background-tab return doesn't teleport bees.
      const dt = Math.min(p.deltaTime / 1000, 0.05);
      const R = computeDetectRadius(p.width);
      const world = { w: p.width, h: p.height };

      // Pollen trail — spawn stamp if pointer is moving, then draw.
      // Drawn BEFORE bees so bees render on top.
      if (pointer.seen) { addPollenStamp(pointer.x, pointer.y, now); }
      tickPollenTrail(now);
      drawPollenTrail(now);

      for (const bee of bees) {
        tickBee({ bee, pointer, dt, detectRadius: R, now, noise, world, allBees: bees });
      }
      for (const bee of bees) {
        const facingRight = pointer.seen && pointer.x > bee.pos.x;

        // 1. Body glow — behind both wings
        drawBee(p, bee, now, facingRight);

        // 2. Back wing
        p.push();
        p.translate(bee.pos.x, bee.pos.y);
        p.scale(bee.scale);
        p.translate(-CANONICAL_CX, -CANONICAL_CY);
        if (facingRight) { p.translate(CANONICAL_W, 0); p.scale(-1, 1); }
        drawWing(p, bee, BACK_WING);
        p.pop();

        // 3. Front wing — on top of back wing; both sit equally above the glow
        p.push();
        p.translate(bee.pos.x, bee.pos.y);
        p.scale(bee.scale);
        p.translate(-CANONICAL_CX, -CANONICAL_CY);
        if (facingRight) { p.translate(CANONICAL_W, 0); p.scale(-1, 1); }
        drawWing(p, bee, FRONT_WING);
        p.pop();
      }
      drawEyes(p, bees);
    };
  };
}

function spawnInitialBees(p: p5): Bee[] {
  const out: Bee[] = [];
  for (let i = 0; i < INITIAL_BEE_COUNT; i++) {
    out.push(
      createBee({
        id: `bee-${i}`,
        pos: {
          x: p.random(p.width * 0.25, p.width * 0.75),
          y: p.random(p.height * 0.25, p.height * 0.75),
        },
        heading: p.random(0, Math.PI * 2),
        rngSeed: Math.floor(p.random(1, 1e9)),
      }),
    );
  }
  return out;
}

export function drawEyes(p: p5, bees: Bee[]): void {
  for (const bee of bees) {
    const facingRight = pointer.seen && pointer.x > bee.pos.x;
    const flipX = facingRight ? -1 : 1;

    p.push();
    p.translate(bee.pos.x, bee.pos.y);
    p.scale(bee.scale);
    p.translate(-CANONICAL_CX, -CANONICAL_CY);
    if (facingRight) { p.translate(CANONICAL_W, 0); p.scale(-1, 1); }

    // Draw all eye parts: sclerae and pupils (no rotation - head stays level).
    // Pupil x-offset is negated when flipped so pupils still track toward the mouse.
    drawSclera(p, EYE_A);
    drawPupil(p, bee, EYE_A, { x: bee.eyeA.x * flipX, y: bee.eyeA.y });
    drawSclera(p, EYE_B);
    drawPupil(p, bee, EYE_B, { x: bee.eyeB.x * flipX, y: bee.eyeB.y });

    p.pop();
  }
}
