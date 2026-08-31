// ── Soundboard ─────────────────────────────────────────────────────────────

function compSoundboard() {
  const hl     = isHl('soundboard');
  const zF     = BODY_D / 2;
  const frontA = sectionOn ? 100 : 255;
  const gl     = drawingContext;

  // Front face fill. drawDepthMask() pre-writes the body front face at zF,
  // so default gl.LESS rejects equal-depth fragments here — LEQUAL lets the
  // fill draw on top of the mask.
  push(); noStroke();
  gl.depthFunc(gl.LEQUAL);
  hlFill(hl, 245, 245, 220, frontA);  // CSS 'beige' — matches page background
  beginShape();
  for (const p of bodyPts) vertex(p.x, p.y, zF);
  beginContour();
  for (let i = holePts.length - 1; i >= 0; i--) vertex(holePts[i].x, holePts[i].y, zF);
  endContour();
  endShape(CLOSE);
  // Dark sound-hole overlay
  gl.depthFunc(gl.LEQUAL);
  fill(14, 14, 16, 255);
  beginShape();
  for (const p of holePts) vertex(p.x, p.y, zF + 0.2);
  endShape(CLOSE);
  gl.depthFunc(gl.LESS);
  pop();

  // Front outline
  push(); noFill();
  gl.depthFunc(gl.LEQUAL);
  hlStroke(hl, C_LINE, EDGE_WT);
  beginShape(); for (const p of bodyPts) vertex(p.x, p.y, zF + 0.25); endShape(CLOSE);
  pop(); gl.depthFunc(gl.LESS);

  // Sound-hole edge
  push(); noFill();
  gl.depthFunc(gl.LEQUAL);
  hlStroke(hl, C_LINE, EDGE_WT);
  beginShape(); for (const p of holePts) vertex(p.x, p.y, zF + 0.3); endShape(CLOSE);
  pop(); gl.depthFunc(gl.LESS);

  // Rosette
  push(); noFill();
  gl.depthFunc(gl.LEQUAL);
  hlStroke(hl, C_DIM, HAIR_WT);
  const rz = zF + 0.3;
  beginShape(); for (let i = 0; i <= HOLE_SEGS; i++) { const a = i / HOLE_SEGS * TWO_PI; vertex((SH_R + 8)  * cos(a), SH_CY + (SH_R + 8)  * sin(a), rz); } endShape();
  beginShape(); for (let i = 0; i <= HOLE_SEGS; i++) { const a = i / HOLE_SEGS * TWO_PI; vertex((SH_R + 12) * cos(a), SH_CY + (SH_R + 12) * sin(a), rz); } endShape();
  pop(); gl.depthFunc(gl.LESS);
}

// Y-ranges where a vertical line at x=x0 lies inside the body outline.
// Walks rightHalfPts (bot→top) and tracks contiguous runs of |x0|<p.x.
// Handles the guitar waist correctly (can return 2 ranges when x0 is in the bout region).
function bodyYRangesAtX(x0) {
  const ranges = [];
  const absX   = Math.abs(x0);
  const n      = rightHalfPts.length;
  let inside   = false, startY = null, prev = null;
  for (let i = 0; i < n; i++) {
    const p   = rightHalfPts[i];
    const now = (absX < p.x);
    if (now && !inside) startY = (prev ? prev.y : p.y);
    else if (!now && inside) ranges.push([Math.min(startY, p.y), Math.max(startY, p.y)]);
    inside = now; prev = p;
  }
  if (inside) {
    const last = rightHalfPts[n - 1];
    ranges.push([Math.min(startY, last.y), Math.max(startY, last.y)]);
  }
  return ranges;
}

// ── Back ───────────────────────────────────────────────────────────────────

function compBack() {
  const hl      = isHl('back');
  const zB      = -BODY_D / 2;
  const gl      = drawingContext;
  const exploded = explodeT > 0.01;

  // Back face — textured with the animated grain buffer (particle flow field
  // from openprocessing/1250270, reduced to monochrome). LEQUAL so the fill
  // lands on top of the depth mask. Hover highlight uses solid fill instead.
  push(); noStroke();
  gl.depthFunc(gl.LEQUAL);
  if (hl) {
    fill(...HL_FILL);
    beginShape();
    for (let i = bodyPts.length - 1; i >= 0; i--) vertex(bodyPts[i].x, bodyPts[i].y, zB);
    endShape(CLOSE);
  } else if (isHl('sides')) {
    // When sides are hovered the camera moves to a 3/4 view that exposes the
    // back-face interior through the gaps between the two side ribbons. Swap
    // out the grain texture for plain beige so those exposed areas read as
    // empty body interior instead of distracting grain lines.
    fill(C_WOOD[0], C_WOOD[1], C_WOOD[2], 255);
    beginShape();
    for (let i = bodyPts.length - 1; i >= 0; i--) vertex(bodyPts[i].x, bodyPts[i].y, zB);
    endShape(CLOSE);
  } else if (sectionOn) {
    fill(C_WOOD[0], C_WOOD[1], C_WOOD[2], 15);
    beginShape();
    for (let i = bodyPts.length - 1; i >= 0; i--) vertex(bodyPts[i].x, bodyPts[i].y, zB);
    endShape(CLOSE);
  } else {
    let maxW = 0;
    for (const p of rightHalfPts) if (p.x > maxW) maxW = p.x;
    const xSpan = 2 * maxW;
    const ySpan = G.yBot - G.yTop;
    const cy    = (G.yTop + G.yBot) / 2;
    const fanZ  = zB - 0.1;  // just behind the depth mask to dodge z-fighting
    textureMode(NORMAL);
    texture(grainBuf);
    // TRIANGLE_FAN avoids the polygon tessellator — critical for perf with ~1000 verts.
    // Guitar body is star-shaped w.r.t. centroid (0, cy) so the fan is valid.
    // pad insets uvs so the body outline maps to the dense inner region of the buffer.
    const pad  = 0.07;
    const uvU  = (x) => pad + ((x + maxW) / xSpan) * (1 - 2 * pad);
    const uvV  = (y) => pad + ((y - G.yTop) / ySpan) * (1 - 2 * pad);
    beginShape(TRIANGLE_FAN);
    vertex(0, cy, fanZ, 0.5, uvV(cy));
    for (let i = bodyPts.length - 1; i >= 0; i--) {
      const p = bodyPts[i];
      vertex(p.x, p.y, fanZ, uvU(p.x), uvV(p.y));
    }
    // Close the fan by repeating the first boundary vertex
    const first = bodyPts[bodyPts.length - 1];
    vertex(first.x, first.y, fanZ, uvU(first.x), uvV(first.y));
    endShape();
  }
  pop(); gl.depthFunc(gl.LESS);

  // Back outline: dashed at rest, solid once exploded.
  push(); noFill();
  gl.depthFunc(gl.LEQUAL);
  hlStroke(hl, C_DIM, THIN_WT);
  if (exploded) {
    beginShape(); for (const p of bodyPts) vertex(p.x, p.y, zB - 0.2); endShape(CLOSE);
  } else {
    dashPolylineAtZ(bodyPts, zB - 0.2);
  }
  pop(); gl.depthFunc(gl.LESS);
}

// ── Sides ──────────────────────────────────────────────────────────────────

function compSides() {
  const hl    = isHl('sides');
  const zF    = BODY_D / 2, zB = -BODY_D / 2;
  const restA = sectionOn ? 15 : 30;
  const SIDES_SPLIT_X = 26;
  const splitX    = SIDES_SPLIT_X * easedT();
  const gl        = drawingContext;
  const useTexture = !hl && !sectionOn;
  const n         = rightHalfPts.length;

  // Sides use a dedicated tall/narrow grain buffer (48×576) whose aspect
  // matches the ribbon (~1:12), so texels land ~1:1 in world space and the
  // particle flow (biased along the long axis in stepSideGrain) reads as
  // grain running along the bent wood strip. Full uv mapping — both halves
  // sample identically so they book-match at the tail and neck-heel seams.
  //   u: 0 at zF → 1 at zB
  //   v: 0 at (0,yBot) → 1 at (xTop,yTop) along rightHalfPts
  push(); noStroke();
  gl.depthFunc(gl.LEQUAL);

  const solidFillOrHl = () => {
    if (hl) fill(HL_FILL[0], HL_FILL[1], HL_FILL[2], 220);
    else if (sectionOn) fill(C_WOOD[0], C_WOOD[1], C_WOOD[2], restA);
    else fill(C_WOOD[0], C_WOOD[1], C_WOOD[2], 255);
  };

  // Right half outer ribbon
  push(); translate(splitX, 0, 0);
  if (useTexture) {
    const sPad = 0.07;
    const sU0  = sPad, sU1 = 1 - sPad;
    textureMode(NORMAL);
    texture(sideGrainBuf);
    beginShape(TRIANGLE_STRIP);
    for (let i = 0; i < n; i++) {
      const p  = rightHalfPts[i];
      const sv = sPad + (i / (n - 1)) * (1 - 2 * sPad);
      vertex(p.x, p.y, zF, sU0, sv);
      vertex(p.x, p.y, zB, sU1, sv);
    }
    endShape();
  } else {
    solidFillOrHl();
    beginShape(TRIANGLE_STRIP);
    for (const p of rightHalfPts) { vertex(p.x, p.y, zF); vertex(p.x, p.y, zB); }
    endShape();
  }
  pop();

  // Left half outer ribbon (mirror, same uv so tail + heel seams book-match)
  push(); translate(-splitX, 0, 0);
  if (useTexture) {
    const sPad = 0.07;
    const sU0  = sPad, sU1 = 1 - sPad;
    textureMode(NORMAL);
    texture(sideGrainBuf);
    beginShape(TRIANGLE_STRIP);
    for (let i = 0; i < n; i++) {
      const p  = rightHalfPts[i];
      const sv = sPad + (i / (n - 1)) * (1 - 2 * sPad);
      vertex(-p.x, p.y, zF, sU0, sv);
      vertex(-p.x, p.y, zB, sU1, sv);
    }
    endShape();
  } else {
    solidFillOrHl();
    beginShape(TRIANGLE_STRIP);
    for (const p of rightHalfPts) { vertex(-p.x, p.y, zF); vertex(-p.x, p.y, zB); }
    endShape();
  }
  pop();

  // Inner cut caps at x=0, yTop and yBot — only rendered once the sides
  // have actually split apart (splitX > 0.5) to avoid phantom interior
  // panels being visible at the start of a hover before the explode begins.
  if (splitX > 0.5) {
    solidFillOrHl();
    const rLast = rightHalfPts[n - 1];
    push(); translate(splitX, 0, 0);
    beginShape(TRIANGLE_STRIP);
    vertex(rLast.x, rLast.y, zF); vertex(rLast.x, rLast.y, zB);
    vertex(0, G.yTop, zF); vertex(0, G.yTop, zB);
    vertex(0, G.yBot, zF); vertex(0, G.yBot, zB);
    endShape();
    pop();

    push(); translate(-splitX, 0, 0);
    beginShape(TRIANGLE_STRIP);
    vertex(-rLast.x, rLast.y, zF); vertex(-rLast.x, rLast.y, zB);
    vertex(0, G.yTop, zF); vertex(0, G.yTop, zB);
    vertex(0, G.yBot, zF); vertex(0, G.yBot, zB);
    endShape();
    pop();
  }

  pop(); gl.depthFunc(gl.LESS);
}

// ── Bridge ─────────────────────────────────────────────────────────────────

function compBridge() {
  const hl  = isHl('bridge');
  const gl  = drawingContext;
  const bx  = BR_W / 2, by0 = BR_Y - BR_H / 2, by1 = BR_Y + BR_H / 2;
  const zF  = BODY_D / 2 + 0.3, zT = BODY_D / 2 + BR_D;

  push(); noFill();
  gl.depthFunc(gl.LEQUAL);
  hlStroke(hl, C_LINE, THIN_WT);
  line(-bx, by0, zT,  bx, by0, zT);
  line( bx, by0, zT,  bx, by1, zT);
  line( bx, by1, zT, -bx, by1, zT);
  line(-bx, by1, zT, -bx, by0, zT);

  gl.depthFunc(gl.ALWAYS);
  hlStroke(hl, C_DIM, HAIR_WT);
  dashLine(-bx, by0, zF, -bx, by0, zT); dashLine(bx, by0, zF,  bx, by0, zT);
  dashLine(-bx, by1, zF, -bx, by1, zT); dashLine(bx, by1, zF,  bx, by1, zT);
  dashLine(-bx, by0, zF,  bx, by0, zF); dashLine(bx, by0, zF,  bx, by1, zF);
  dashLine( bx, by1, zF, -bx, by1, zF); dashLine(-bx, by1, zF, -bx, by0, zF);

  // Saddle (rides on bridge top)
  const sx = SAD_W / 2, sy0 = BR_Y - SAD_H / 2, sy1 = BR_Y + SAD_H / 2;
  const sz = BODY_D / 2 + BR_D + SAD_D;
  gl.depthFunc(gl.LEQUAL);
  hlStroke(hl, C_LINE, HAIR_WT);
  line(-sx, sy0, sz, sx, sy0, sz);
  line( sx, sy0, sz, sx, sy1, sz);
  line( sx, sy1, sz, -sx, sy1, sz);
  line(-sx, sy1, sz, -sx, sy0, sz);
  pop(); gl.depthFunc(gl.LESS);
}

// ── Neck ───────────────────────────────────────────────────────────────────

function compNeck() {
  const hl = isHl('neck');
  const gl = drawingContext;
  const { w0, w1, d0, d1 } = neckDims();

  // Prism fill. Always drawn so the neck reads as a solid object — without
  // this the body's back panel (which ends at yTop) leaves a see-through hole
  // above the body where the page background would otherwise show through.
  push(); noStroke();
  gl.depthFunc(gl.LEQUAL);
  if (hl)              fill(...HL_FILL);
  else if (sectionOn)  fill(C_WOOD[0], C_WOOD[1], C_WOOD[2], 15);
  else                 fill(C_WOOD[0], C_WOOD[1], C_WOOD[2], 255);
  beginShape(); vertex(-w0, NK_Y0,  d0); vertex( w0, NK_Y0,  d0); vertex( w1, NK_Y1,  d1); vertex(-w1, NK_Y1,  d1); endShape(CLOSE);
  beginShape(); vertex( w0, NK_Y0, -d0); vertex(-w0, NK_Y0, -d0); vertex(-w1, NK_Y1, -d1); vertex( w1, NK_Y1, -d1); endShape(CLOSE);
  beginShape(); vertex( w0, NK_Y0,  d0); vertex( w0, NK_Y0, -d0); vertex( w1, NK_Y1, -d1); vertex( w1, NK_Y1,  d1); endShape(CLOSE);
  beginShape(); vertex(-w0, NK_Y0, -d0); vertex(-w0, NK_Y0,  d0); vertex(-w1, NK_Y1,  d1); vertex(-w1, NK_Y1, -d1); endShape(CLOSE);
  pop(); gl.depthFunc(gl.LESS);

  // Edges
  push(); noFill();
  gl.depthFunc(gl.LEQUAL);
  hlStroke(hl, C_LINE, EDGE_WT);
  line(-w0, NK_Y0, d0, -w1, NK_Y1, d1);
  line( w0, NK_Y0, d0,  w1, NK_Y1, d1);
  line(-w0, NK_Y0, d0,  w0, NK_Y0, d0);
  strokeWeight(THIN_WT);
  line(-w1, NK_Y1,  d1,  w1, NK_Y1,  d1);
  line(-w1, NK_Y1, -d1,  w1, NK_Y1, -d1);
  line( w1, NK_Y1,  d1,  w1, NK_Y1, -d1);
  line(-w1, NK_Y1,  d1, -w1, NK_Y1, -d1);

  gl.depthFunc(gl.ALWAYS);
  hlStroke(hl, C_DIM, THIN_WT);
  dashLine(-w0, NK_Y0, -d0, -w1, NK_Y1, -d1);
  dashLine( w0, NK_Y0, -d0,  w1, NK_Y1, -d1);
  dashLine(-w0, NK_Y0, -d0,  w0, NK_Y0, -d0);
  dashLine( w0, NK_Y0,  d0,  w0, NK_Y0, -d0);
  dashLine(-w0, NK_Y0,  d0, -w0, NK_Y0, -d0);
  pop(); gl.depthFunc(gl.LESS);
}

// ── Fretboard ──────────────────────────────────────────────────────────────

function compFretboard() {
  const hl  = isHl('fretboard');
  const gl  = drawingContext;
  const { d0, d1, dFB, fbZFB, fbZNt, wFB, wNt } = fretboardDims();
  const restA = sectionOn ? 15 : 90;

  // Top face fill — grain-textured at rest; solid for hover/section so the
  // highlight and x-ray tints read cleanly without the grain muddying them.
  push(); noStroke();
  if (hl) {
    fill(...HL_FILL);
    beginShape();
    vertex(-wFB, FB_END_Y, fbZFB); vertex(wFB, FB_END_Y, fbZFB);
    vertex( wNt, NK_Y1,    fbZNt); vertex(-wNt, NK_Y1,   fbZNt);
    endShape(CLOSE);
  } else if (sectionOn) {
    fill(C_WOOD[0], C_WOOD[1], C_WOOD[2], restA);
    beginShape();
    vertex(-wFB, FB_END_Y, fbZFB); vertex(wFB, FB_END_Y, fbZFB);
    vertex( wNt, NK_Y1,    fbZNt); vertex(-wNt, NK_Y1,   fbZNt);
    endShape(CLOSE);
  } else {
    fill(C_WOOD[0], C_WOOD[1], C_WOOD[2], 90);
    beginShape();
    vertex(-wFB, FB_END_Y, fbZFB);
    vertex( wFB, FB_END_Y, fbZFB);
    vertex( wNt, NK_Y1,    fbZNt);
    vertex(-wNt, NK_Y1,    fbZNt);
    endShape(CLOSE);
  }
  pop();

  // Edges
  push(); noFill();
  gl.depthFunc(gl.LEQUAL);
  hlStroke(hl, C_LINE, THIN_WT);
  line(-wFB, FB_END_Y, fbZFB,  wFB, FB_END_Y, fbZFB);
  line( wFB, FB_END_Y, fbZFB,  wNt, NK_Y1,    fbZNt);
  line(-wFB, FB_END_Y, fbZFB, -wNt, NK_Y1,    fbZNt);
  line(-wNt, NK_Y1,    fbZNt,  wNt, NK_Y1,    fbZNt);
  gl.depthFunc(gl.ALWAYS);
  hlStroke(hl, C_DIM, HAIR_WT);
  dashLine( wFB, FB_END_Y, dFB,  wFB, FB_END_Y, fbZFB);
  dashLine(-wFB, FB_END_Y, dFB, -wFB, FB_END_Y, fbZFB);
  dashLine( wNt, NK_Y1,    d1,   wNt, NK_Y1,    fbZNt);
  dashLine(-wNt, NK_Y1,    d1,  -wNt, NK_Y1,    fbZNt);
  pop(); gl.depthFunc(gl.LESS);

  // Inlay dots ride with fretboard
  compInlayDots(hl);
}

function compInlayDots(hl) {
  const gl = drawingContext; gl.depthFunc(gl.LEQUAL);
  push(); noFill();
  hlStroke(hl, C_DIM, HAIR_WT);
  const { d0, d1 } = neckDims();
  const r = 3;
  for (const n of [3, 5, 7, 9, 15, 17, 19]) {
    const fy = (fretY(n) + fretY(n - 1)) / 2;
    if (fy > FB_END_Y) continue;
    const t  = constrain((fy - NK_Y0) / (NK_Y1 - NK_Y0), 0, 1);
    const zI = lerp(d0, d1, t) + FB_THICK + 0.3;
    push(); translate(0, fy, zI); circlePoly(r); pop();
  }
  for (const n of [12]) {
    const fy = (fretY(n) + fretY(n - 1)) / 2;
    if (fy > FB_END_Y) continue;
    const t12  = constrain((fy - NK_Y0) / (NK_Y1 - NK_Y0), 0, 1);
    const zI12 = lerp(d0, d1, t12) + FB_THICK + 0.3;
    for (const ox of [-8, 8]) { push(); translate(ox, fy, zI12); circlePoly(r); pop(); }
  }
  pop(); gl.depthFunc(gl.LESS);
}

// ── Frets ──────────────────────────────────────────────────────────────────

function compFrets() {
  const hl = isHl('frets');
  const gl = drawingContext; gl.depthFunc(gl.LEQUAL);
  push(); noFill();
  hlStroke(hl, C_FRET, HAIR_WT);
  const { w0, w1, d0, d1 } = neckDims();
  for (let n = 1; n <= N_FRET; n++) {
    const fy = fretY(n);
    if (fy > FB_END_Y) continue;
    const t    = constrain((fy - NK_Y0) / (NK_Y1 - NK_Y0), 0, 1);
    const hw   = lerp(w0, w1, t) + FB_W_EXTRA - 1;
    const zFret = lerp(d0, d1, t) + FB_THICK + 0.3;
    line(-hw, fy, zFret, hw, fy, zFret);
  }
  pop(); gl.depthFunc(gl.LESS);
}

// ── Nut ────────────────────────────────────────────────────────────────────

function compNut() {
  const hl = isHl('nut');
  const gl = drawingContext; gl.depthFunc(gl.LEQUAL);
  push(); noFill();
  hlStroke(hl, C_LINE, HAIR_WT);
  const nx  = NUT_W / 2, ny0 = NK_Y1 - NUT_H / 2, ny1 = NK_Y1 + NUT_H / 2;
  const nz  = HD_D / 2 + FB_THICK + NUT_D;
  line(-nx, ny0, nz, nx, ny0, nz);
  line( nx, ny0, nz, nx, ny1, nz);
  line( nx, ny1, nz, -nx, ny1, nz);
  line(-nx, ny1, nz, -nx, ny0, nz);
  pop(); gl.depthFunc(gl.LESS);
}

// ── Headstock ──────────────────────────────────────────────────────────────

function compHeadstock() {
  const hl = isHl('headstock');
  const gl = drawingContext;

  push(); translate(0, NK_Y1, 0); rotateX(HD_ANG);
  const hw = HD_W / 2, hd = HD_D / 2;

  // Prism fill — skipped at rest so headstock is wireframe-only.
  if (hl || sectionOn) {
    push(); noStroke();
    hlFill(hl, 210, 200, 180, 15);
    beginShape(); vertex(-hw, 0, hd); vertex(hw, 0, hd); vertex(hw, -HD_LEN, hd); vertex(-hw, -HD_LEN, hd); endShape(CLOSE);
    beginShape(); vertex(hw, 0, -hd); vertex(-hw, 0, -hd); vertex(-hw, -HD_LEN, -hd); vertex(hw, -HD_LEN, -hd); endShape(CLOSE);
    beginShape(); vertex(hw, 0, hd); vertex(hw, 0, -hd); vertex(hw, -HD_LEN, -hd); vertex(hw, -HD_LEN, hd); endShape(CLOSE);
    beginShape(); vertex(-hw, 0, -hd); vertex(-hw, 0, hd); vertex(-hw, -HD_LEN, hd); vertex(-hw, -HD_LEN, -hd); endShape(CLOSE);
    beginShape(); vertex(-hw, -HD_LEN, hd); vertex(hw, -HD_LEN, hd); vertex(hw, -HD_LEN, -hd); vertex(-hw, -HD_LEN, -hd); endShape(CLOSE);
    pop();
  }

  // Edges (no pegs — pegs are a separate component)
  push(); noFill();
  gl.depthFunc(gl.LEQUAL);
  hlStroke(hl, C_LINE, EDGE_WT);
  line(-hw, 0, hd,       hw, 0, hd);
  line( hw, 0, hd,       hw, -HD_LEN, hd);
  line( hw, -HD_LEN, hd, -hw, -HD_LEN, hd);
  line(-hw, -HD_LEN, hd, -hw, 0, hd);
  gl.depthFunc(gl.ALWAYS);
  hlStroke(hl, C_DIM, THIN_WT);
  dashLine(-hw, 0, -hd,       hw, 0, -hd);
  dashLine( hw, 0, -hd,       hw, -HD_LEN, -hd);
  dashLine( hw, -HD_LEN, -hd, -hw, -HD_LEN, -hd);
  dashLine(-hw, -HD_LEN, -hd, -hw, 0, -hd);
  dashLine( hw, 0, hd,        hw, 0, -hd);
  dashLine(-hw, 0, hd,       -hw, 0, -hd);
  dashLine( hw, -HD_LEN, hd,  hw, -HD_LEN, -hd);
  dashLine(-hw, -HD_LEN, hd, -hw, -HD_LEN, -hd);
  pop(); gl.depthFunc(gl.LESS);

  pop();
}

// ── Tuning pegs ────────────────────────────────────────────────────────────

function compTuningPegs() {
  const hl = isHl('tuning_pegs');
  const gl = drawingContext;
  // Explode in headstock-local +Z so pegs lift perpendicular to the face.
  const [, , dzLocal] = explodeOffset('tuning_pegs');

  push(); translate(0, NK_Y1, 0); rotateX(HD_ANG);
  if (dzLocal) translate(0, 0, dzLocal);

  gl.depthFunc(gl.LEQUAL);
  push(); noFill();
  hlStroke(hl, C_DIM, HAIR_WT);
  const hw = HD_W / 2, hd = HD_D / 2;
  for (let i = 0; i < N_STR; i++) {
    const { px, py } = pegLocalPos(i, hw);
    push(); translate(px, py, hd + 0.3); circlePoly(5); pop();
  }
  pop(); gl.depthFunc(gl.LESS);
  pop();
}

// ── Strings ────────────────────────────────────────────────────────────────

function compStrings() {
  const hl      = isHl('strings');
  const gl      = drawingContext; gl.depthFunc(gl.LEQUAL);
  push(); noFill();
  const zBridge = BODY_D / 2 + BR_D + SAD_D;
  const zNut    = HD_D / 2 + FB_THICK + NUT_D;
  const zBody   = BODY_D / 2 + 2;
  const bodyBot = G.yBot;
  const holeR2  = SH_R * SH_R;
  for (let i = 0; i < N_STR; i++) {
    const frac    = i / (N_STR - 1);
    const xBr     = lerp(-STR_SP_BR / 2, STR_SP_BR / 2, frac);
    const xNut    = lerp(-STR_SP_NT / 2, STR_SP_NT / 2, frac) + G.neckOX;
    const zNutOff = zNut + G.neckOZ;
    const sw      = lerp(1.4, 0.5, frac);
    strokeWeight(sw);
    for (let s = 0; s < STRING_SEGS; s++) {
      const t1 = s / STRING_SEGS, t2 = (s + 1) / STRING_SEGS;
      let x1 = lerp(xBr, xNut, t1), y1 = lerp(BR_Y, NK_Y1, t1), z1 = lerp(zBridge, zNutOff, t1);
      let x2 = lerp(xBr, xNut, t2), y2 = lerp(BR_Y, NK_Y1, t2), z2 = lerp(zBridge, zNutOff, t2);
      if (y1 > NK_Y0 && y1 < bodyBot) z1 = Math.max(z1, zBody);
      if (y2 > NK_Y0 && y2 < bodyBot) z2 = Math.max(z2, zBody);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const overHole = (mx * mx + (my - SH_CY) * (my - SH_CY)) < holeR2;
      stroke(...(hl ? HL_DARK : (overHole ? C_STR_INV : C_STR)));
      line(x1, y1, z1, x2, y2, z2);
    }
    stroke(...(hl ? HL_DARK : C_STR));
    const peg = pegWorldPos(i);
    line(xNut, NK_Y1, Math.max(zNutOff, zBody),
         peg.x + G.neckOX, peg.y, peg.z + G.neckOZ);
  }
  pop(); gl.depthFunc(gl.LESS);
}

// ── Main-pass dispatch ─────────────────────────────────────────────────────

function drawAllComponents() {
  push(); applyExplode('soundboard'); compSoundboard(); pop();
  push(); applyExplode('back');       compBack();       pop();
  push(); applyExplode('sides');      compSides();      pop();
  push(); applyExplode('bridge');     compBridge();     pop();

  push(); translate(G.neckOX, 0, G.neckOZ);
    push(); applyExplode('neck');      compNeck();      pop();
    push(); applyExplode('fretboard'); compFretboard(); pop();
    push(); applyExplode('frets');     compFrets();     pop();
    push(); applyExplode('nut');       compNut();       pop();
    push(); applyExplode('headstock'); compHeadstock(); pop();
    compTuningPegs();  // applies its own local-frame explode internally
  pop();

  push(); applyExplode('strings'); compStrings(); pop();
}
