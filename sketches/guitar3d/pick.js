// ── Pick state ─────────────────────────────────────────────────────────────
let pickGfx   = null;
let pickDebug = false;
let hoveredId = null;        // instant — drives highlight color + HUD label
let zoomTargetId = null;     // dwell-committed — drives camera + explode
let pendingZoomId = null;
let pendingZoomSince = 0;
const ZOOM_DWELL_MS   = 250;  // steady hover required before camera commits
const ZOOM_RELEASE_MS = 500;  // cursor-off required before commitment releases
const PICK_COUNTS = new Uint8Array(256);

// ── Setup ──────────────────────────────────────────────────────────────────

function setupPick() {
  pickGfx = createGraphics(windowWidth, windowHeight, WEBGL);
  pickGfx.pixelDensity(1);
  pickGfx.noSmooth();
  const c = pickGfx.canvas;
  document.body.appendChild(c);
  c.style.position     = 'fixed';
  c.style.top          = '16px';
  c.style.left         = '16px';
  c.style.width        = '260px';
  c.style.height       = '180px';
  c.style.border       = '1px solid #8af';
  c.style.borderRadius = '4px';
  c.style.pointerEvents = 'none';
  c.style.zIndex       = '20';
  c.style.display      = 'none';
}

// ── Pick pass ──────────────────────────────────────────────────────────────

function runPickPass(sc, tRot, rotAmp) {
  if (!pickGfx) return;
  pickGfx.camera(cam.eyeX, cam.eyeY, cam.eyeZ,
                 cam.centerX, cam.centerY, cam.centerZ,
                 cam.upX, cam.upY, cam.upZ);
  pickGfx.perspective(cam.cameraFOV, width / height, cam.cameraNear, cam.cameraFar);

  pickGfx.background(0);
  pickGfx.push();
  pickGfx.scale(sc);
  pickGfx.translate(0, 120, 0);
  pickGfx.rotateX((noise(1 + tRot) - 0.5) * rotAmp);
  pickGfx.rotateY((noise(2 + tRot) - 0.5) * rotAmp);
  pickGfx.rotateZ((noise(3 + tRot) - 0.5) * rotAmp);

  pickPassComp('soundboard', drawSoundboardPickGeom);
  pickPassComp('back',       drawBackPickGeom);
  pickPassComp('sides',      drawSidesPickGeom);
  pickPassComp('bridge',     drawBridgePickGeom);

  pickGfx.push();
  pickGfx.translate(G.neckOX, 0, G.neckOZ);
  pickPassComp('neck',      drawNeckPickGeom);
  pickPassComp('fretboard', drawFretboardPickGeom);
  pickPassComp('frets',     drawFretsPickGeom);
  pickPassComp('nut',       drawNutPickGeom);
  pickPassComp('headstock', drawHeadstockPickGeom);
  // Tuning pegs: explode in headstock-local frame (+Z perpendicular to face)
  pickGfx.push();
  pickFill('tuning_pegs');
  drawTuningPegsPickGeom(pickGfx, explodeOffset('tuning_pegs')[2]);
  pickGfx.pop();
  pickGfx.pop();

  pickGfx.push();
  applyExplodePick(pickGfx, 'strings');
  // Thicker stroke in the pick buffer than the visible render — gives thin
  // strings a reasonable cursor footprint without widening the drawn lines.
  pickStroke('strings', 10);
  drawStringsPickGeom(pickGfx);
  pickGfx.pop();

  pickGfx.pop();
}

function pickPassComp(id, drawFn) {
  pickGfx.push();
  applyExplodePick(pickGfx, id);
  pickFill(id);
  drawFn(pickGfx);
  pickGfx.pop();
}

function readPickAtMouse() {
  if (!pickGfx) return null;
  const mx = Math.floor(mouseX), my = Math.floor(mouseY);
  if (mx < 1 || my < 1 || mx >= width - 1 || my >= height - 1) return null;

  // 3×3 majority vote. Tolerates 1-px aliasing on thin geometry (strings,
  // frets, nut edges) so the cursor doesn't flip between neighbors as it
  // grazes an edge. loadPixels() triggers gl.readPixels on the pickGfx
  // framebuffer — p5 flips the pixels back to top-left origin so direct
  // indexing matches mouse coords. Single-pixel get() internally pays the
  // same readback cost, so this isn't more expensive.
  pickGfx.loadPixels();
  const px = pickGfx.pixels;
  const W = pickGfx.width;  // pixelDensity is 1 on pickGfx, so width == buffer width
  PICK_COUNTS.fill(0);
  let bestR = 0, bestCount = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const rowBase = (my + dy) * W;
    for (let dx = -1; dx <= 1; dx++) {
      const idx = (rowBase + (mx + dx)) * 4;
      const a = px[idx + 3];
      if (a === 0) continue;
      const r = px[idx];
      if (r === 0) continue;
      const c = ++PICK_COUNTS[r];
      if (c > bestCount) { bestCount = c; bestR = r; }
    }
  }
  if (bestR === 0) return null;
  return PICK_BY_R.get(bestR) || null;
}

// ── Hover-to-zoom commitment ──────────────────────────────────────────────
// Instant hoveredId drives highlight color + HUD. zoomTargetId commits only
// after ZOOM_DWELL_MS of steady hover — brief cursor slips across thin parts
// don't punt the camera. Null-dwell (ZOOM_RELEASE_MS) releases the commitment
// so manual orbit becomes available again.
function updateZoomTarget() {
  const now = millis();
  if (hoveredId !== pendingZoomId) {
    pendingZoomId    = hoveredId;
    pendingZoomSince = now;
    return;
  }
  const dwell = now - pendingZoomSince;
  if (pendingZoomId && pendingZoomId !== zoomTargetId && dwell >= ZOOM_DWELL_MS) {
    zoomTargetId = pendingZoomId;
  } else if (pendingZoomId === null && zoomTargetId && dwell >= ZOOM_RELEASE_MS) {
    zoomTargetId = null;
  }
}

function pickFill(id) {
  pickGfx.noStroke();
  pickGfx.fill(PICK_BY_ID.get(id), 0, 0);
}
function pickStroke(id, w) {
  pickGfx.noFill();
  pickGfx.stroke(PICK_BY_ID.get(id), 0, 0);
  pickGfx.strokeWeight(w);
}

// ── Per-component pick geometry (fills only) ──────────────────────────────

function drawSoundboardPickGeom(g) {
  const zF = BODY_D / 2;
  g.beginShape();
  for (const p of bodyPts) g.vertex(p.x, p.y, zF);
  g.beginContour();
  for (let i = holePts.length - 1; i >= 0; i--) g.vertex(holePts[i].x, holePts[i].y, zF);
  g.endContour();
  g.endShape(CLOSE);
}

function drawBackPickGeom(g) {
  const zB = -BODY_D / 2;
  g.beginShape();
  for (let i = bodyPts.length - 1; i >= 0; i--) g.vertex(bodyPts[i].x, bodyPts[i].y, zB);
  g.endShape(CLOSE);
}

function drawSidesPickGeom(g) {
  const zF = BODY_D / 2, zB = -BODY_D / 2;
  const SIDES_SPLIT_X = 26;
  const splitX = SIDES_SPLIT_X * easedT();

  g.push(); g.translate(splitX, 0, 0);
  g.beginShape(TRIANGLE_STRIP);
  for (const p of rightHalfPts) {
    g.vertex(p.x, p.y, zF); g.vertex(p.x, p.y, zB);
  }
  g.vertex(0, G.yTop, zF); g.vertex(0, G.yTop, zB);
  g.vertex(0, G.yBot, zF); g.vertex(0, G.yBot, zB);
  g.endShape();
  g.pop();

  g.push(); g.translate(-splitX, 0, 0);
  g.beginShape(TRIANGLE_STRIP);
  for (const p of rightHalfPts) {
    g.vertex(-p.x, p.y, zF); g.vertex(-p.x, p.y, zB);
  }
  g.vertex(0, G.yTop, zF); g.vertex(0, G.yTop, zB);
  g.vertex(0, G.yBot, zF); g.vertex(0, G.yBot, zB);
  g.endShape();
  g.pop();
}

function drawBridgePickGeom(g) {
  const bx = BR_W / 2, by0 = BR_Y - BR_H / 2, by1 = BR_Y + BR_H / 2;
  const zF = BODY_D / 2, zT = BODY_D / 2 + BR_D;
  g.beginShape(); g.vertex(-bx, by0, zT); g.vertex(bx, by0, zT); g.vertex(bx, by1, zT); g.vertex(-bx, by1, zT); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-bx, by0, zF); g.vertex(bx, by0, zF); g.vertex(bx, by0, zT); g.vertex(-bx, by0, zT); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-bx, by1, zF); g.vertex(bx, by1, zF); g.vertex(bx, by1, zT); g.vertex(-bx, by1, zT); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-bx, by0, zF); g.vertex(-bx, by1, zF); g.vertex(-bx, by1, zT); g.vertex(-bx, by0, zT); g.endShape(CLOSE);
  g.beginShape(); g.vertex( bx, by0, zF); g.vertex( bx, by1, zF); g.vertex( bx, by1, zT); g.vertex( bx, by0, zT); g.endShape(CLOSE);
}

function drawNeckPickGeom(g) {
  const { w0, w1, d0, d1 } = neckDims();
  g.beginShape(); g.vertex(-w0, NK_Y0,  d0); g.vertex( w0, NK_Y0,  d0); g.vertex( w1, NK_Y1,  d1); g.vertex(-w1, NK_Y1,  d1); g.endShape(CLOSE);
  g.beginShape(); g.vertex( w0, NK_Y0, -d0); g.vertex(-w0, NK_Y0, -d0); g.vertex(-w1, NK_Y1, -d1); g.vertex( w1, NK_Y1, -d1); g.endShape(CLOSE);
  g.beginShape(); g.vertex( w0, NK_Y0,  d0); g.vertex( w0, NK_Y0, -d0); g.vertex( w1, NK_Y1, -d1); g.vertex( w1, NK_Y1,  d1); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-w0, NK_Y0, -d0); g.vertex(-w0, NK_Y0,  d0); g.vertex(-w1, NK_Y1,  d1); g.vertex(-w1, NK_Y1, -d1); g.endShape(CLOSE);
}

function drawFretboardPickGeom(g) {
  const { d0, d1, dFB, fbZFB, fbZNt, wFB, wNt } = fretboardDims();
  g.beginShape(); g.vertex(-wFB, FB_END_Y, fbZFB); g.vertex(wFB, FB_END_Y, fbZFB); g.vertex(wNt, NK_Y1, fbZNt); g.vertex(-wNt, NK_Y1, fbZNt); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-wFB, FB_END_Y, dFB); g.vertex(wFB, FB_END_Y, dFB); g.vertex(wFB, FB_END_Y, fbZFB); g.vertex(-wFB, FB_END_Y, fbZFB); g.endShape(CLOSE);
  g.beginShape(); g.vertex( wFB, FB_END_Y, dFB); g.vertex( wFB, FB_END_Y, fbZFB); g.vertex( wNt, NK_Y1, fbZNt); g.vertex( wNt, NK_Y1, d1); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-wFB, FB_END_Y, dFB); g.vertex(-wFB, FB_END_Y, fbZFB); g.vertex(-wNt, NK_Y1, fbZNt); g.vertex(-wNt, NK_Y1, d1); g.endShape(CLOSE);
}

function drawFretsPickGeom(g) {
  const { w0, w1, d0, d1 } = neckDims();
  // Pick-only thickness (visible frets are rendered separately as hair lines).
  // Wider band makes individual frets targetable without pixel-perfect aim.
  const thick = 3;
  for (let n = 1; n <= N_FRET; n++) {
    const fy = fretY(n);
    if (fy > FB_END_Y) continue;
    const t  = constrain((fy - NK_Y0) / (NK_Y1 - NK_Y0), 0, 1);
    const hw = lerp(w0, w1, t) + FB_W_EXTRA - 1;
    const zFret = lerp(d0, d1, t) + FB_THICK + 0.4;
    g.beginShape();
    g.vertex(-hw, fy - thick, zFret);
    g.vertex( hw, fy - thick, zFret);
    g.vertex( hw, fy + thick, zFret);
    g.vertex(-hw, fy + thick, zFret);
    g.endShape(CLOSE);
  }
}

function drawNutPickGeom(g) {
  const nx = NUT_W / 2;
  const ny0 = NK_Y1 - NUT_H / 2, ny1 = NK_Y1 + NUT_H / 2;
  const nzB = HD_D / 2 + FB_THICK, nzT = HD_D / 2 + FB_THICK + NUT_D;
  g.beginShape(); g.vertex(-nx, ny0, nzT); g.vertex(nx, ny0, nzT); g.vertex(nx, ny1, nzT); g.vertex(-nx, ny1, nzT); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-nx, ny0, nzB); g.vertex(nx, ny0, nzB); g.vertex(nx, ny0, nzT); g.vertex(-nx, ny0, nzT); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-nx, ny1, nzB); g.vertex(nx, ny1, nzB); g.vertex(nx, ny1, nzT); g.vertex(-nx, ny1, nzT); g.endShape(CLOSE);
}

function drawHeadstockPickGeom(g) {
  g.push(); g.translate(0, NK_Y1, 0); g.rotateX(HD_ANG);
  const hw = HD_W / 2, hd = HD_D / 2;
  g.beginShape(); g.vertex(-hw, 0, hd); g.vertex(hw, 0, hd); g.vertex(hw, -HD_LEN, hd); g.vertex(-hw, -HD_LEN, hd); g.endShape(CLOSE);
  g.beginShape(); g.vertex(hw, 0, -hd); g.vertex(-hw, 0, -hd); g.vertex(-hw, -HD_LEN, -hd); g.vertex(hw, -HD_LEN, -hd); g.endShape(CLOSE);
  g.beginShape(); g.vertex(hw, 0, hd); g.vertex(hw, 0, -hd); g.vertex(hw, -HD_LEN, -hd); g.vertex(hw, -HD_LEN, hd); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-hw, 0, -hd); g.vertex(-hw, 0, hd); g.vertex(-hw, -HD_LEN, hd); g.vertex(-hw, -HD_LEN, -hd); g.endShape(CLOSE);
  g.beginShape(); g.vertex(-hw, -HD_LEN, hd); g.vertex(hw, -HD_LEN, hd); g.vertex(hw, -HD_LEN, -hd); g.vertex(-hw, -HD_LEN, -hd); g.endShape(CLOSE);
  g.pop();
}

function drawTuningPegsPickGeom(g, localZ = 0) {
  g.push(); g.translate(0, NK_Y1, 0); g.rotateX(HD_ANG);
  if (localZ) g.translate(0, 0, localZ);
  const hw = HD_W / 2, hd = HD_D / 2;
  const R = 7;
  for (let i = 0; i < N_STR; i++) {
    const { px, py } = pegLocalPos(i, hw);
    g.push(); g.translate(px, py, hd + 0.5);
    g.beginShape();
    for (let j = 0; j <= PEG_SEGS; j++) { const a = j / PEG_SEGS * TWO_PI; g.vertex(R * cos(a), R * sin(a)); }
    g.endShape(CLOSE);
    g.pop();
  }
  g.pop();
}

function drawStringsPickGeom(g) {
  const zBridge = BODY_D / 2 + BR_D + SAD_D;
  const zNut    = HD_D / 2 + FB_THICK + NUT_D;
  const zBody   = BODY_D / 2 + 2;
  const bodyBot = G.yBot;
  for (let i = 0; i < N_STR; i++) {
    const frac  = i / (N_STR - 1);
    const xBr   = lerp(-STR_SP_BR / 2, STR_SP_BR / 2, frac);
    const xNut  = lerp(-STR_SP_NT / 2, STR_SP_NT / 2, frac) + G.neckOX;
    const zNutOff = zNut + G.neckOZ;
    g.beginShape();
    for (let s = 0; s <= STRING_SEGS; s++) {
      const t  = s / STRING_SEGS;
      const sx = lerp(xBr, xNut, t);
      const sy = lerp(BR_Y, NK_Y1, t);
      let   sz = lerp(zBridge, zNutOff, t);
      if (sy > NK_Y0 && sy < bodyBot) sz = Math.max(sz, zBody);
      g.vertex(sx, sy, sz);
    }
    g.endShape();
    const peg = pegWorldPos(i);
    g.line(xNut, NK_Y1, Math.max(zNutOff, zBody),
           peg.x + G.neckOX, peg.y, peg.z + G.neckOZ);
  }
}
