// ══════════════════════════════════════════════════════════════════════════
//  DEPTH FILLS
// ══════════════════════════════════════════════════════════════════════════

/** Writes ONLY to the depth buffer (no color output).
 *  Guarantees the solid body faces occlude anything behind them,
 *  independent of fill alpha or blend state. */
function drawDepthMask() {
  if (sectionOn) return;  // let section view see through
  let gl = drawingContext;
  gl.colorMask(false, false, false, false);
  push(); noStroke(); fill(0);

  let zF = BODY_D / 2, zB = -BODY_D / 2;

  // Body front face (with sound-hole cutout)
  beginShape();
  for (let p of bodyPts) vertex(p.x, p.y, zF);
  beginContour();
  for (let i = holePts.length - 1; i >= 0; i--) vertex(holePts[i].x, holePts[i].y, zF);
  endContour();
  endShape(CLOSE);

  // Body back face
  beginShape();
  for (let i = bodyPts.length - 1; i >= 0; i--) vertex(bodyPts[i].x, bodyPts[i].y, zB);
  endShape(CLOSE);

  // Body sides — intentionally NOT pre-written to the depth buffer here.
  // compSides draws the ribbon with a different triangle winding (rightHalfPts
  // in two halves vs bodyPts full loop used here). Identical in geometry,
  // different in z interpolation order → LEQUAL flip-flops per-fragment as the
  // camera microrotates, producing visible flashing streaks. The textured side
  // fill is opaque, so it self-occludes without needing the mask.

  // Neck solid (with depth taper and X/Z offset)
  push(); translate(G.neckOX, 0, G.neckOZ);
  { const { w0, w1, d0, d1 } = neckDims();
    beginShape(); vertex(-w0, NK_Y0,  d0); vertex( w0, NK_Y0,  d0); vertex( w1, NK_Y1,  d1); vertex(-w1, NK_Y1,  d1); endShape(CLOSE);
    beginShape(); vertex( w0, NK_Y0, -d0); vertex(-w0, NK_Y0, -d0); vertex(-w1, NK_Y1, -d1); vertex( w1, NK_Y1, -d1); endShape(CLOSE);
    beginShape(); vertex( w0, NK_Y0,  d0); vertex( w0, NK_Y0, -d0); vertex( w1, NK_Y1, -d1); vertex( w1, NK_Y1,  d1); endShape(CLOSE);
    beginShape(); vertex(-w0, NK_Y0, -d0); vertex(-w0, NK_Y0,  d0); vertex(-w1, NK_Y1,  d1); vertex(-w1, NK_Y1, -d1); endShape(CLOSE); }
  pop();

  pop();
  gl.colorMask(true, true, true, true);
}

// ══════════════════════════════════════════════════════════════════════════
//  OUTLINE RENDERING
// ══════════════════════════════════════════════════════════════════════════

// Dashed-line helpers (ported from openprocessing sketch 2900727, extended to 3D).
// Used for "behind" edges so they read as hidden/occluded like back-of-cube lines.
function dashLine(x1, y1, z1, x2, y2, z2, d = 4) {
  let dst = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1) + (z2 - z1) * (z2 - z1));
  if (dst <= d) { line(x1, y1, z1, x2, y2, z2); return; }
  let n = Math.round(dst / d); if (n % 2 === 0) n++;
  for (let i = 0; i < n; i += 2) {
    let t1 = i / n, t2 = (i + 1) / n;
    line(
      lerp(x1, x2, t1), lerp(y1, y2, t1), lerp(z1, z2, t1),
      lerp(x1, x2, t2), lerp(y1, y2, t2), lerp(z1, z2, t2)
    );
  }
}

function dashPolylineAtZ(pts, z, d = 4) {
  for (let i = 0; i < pts.length; i++) {
    let a = pts[i], b = pts[(i + 1) % pts.length];
    dashLine(a.x, a.y, z, b.x, b.y, z, d);
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  SECTION / INTERNALS / WIREFRAME
// ══════════════════════════════════════════════════════════════════════════

function drawSectionEdges() {
  let gl = drawingContext; gl.depthFunc(gl.LEQUAL);
  push(); noFill(); stroke(...C_LINE, 180); strokeWeight(THIN_WT);
  let zF = BODY_D / 2, zB = -BODY_D / 2, yBot = G.yBot, yTop = NK_Y0, thick = 4;
  line(0, yBot, zB, 0, yBot, zF); line(0, yBot, zF, 0, yTop, zF);
  line(0, yTop, zF, 0, yTop, zB); line(0, yTop, zB, 0, yBot, zB);
  stroke(...C_DIM, 120); strokeWeight(HAIR_WT);
  line(0, yBot - thick, zB + thick, 0, yBot - thick, zF - thick);
  line(0, yBot - thick, zF - thick, 0, yTop + thick, zF - thick);
  line(0, yTop + thick, zF - thick, 0, yTop + thick, zB + thick);
  line(0, yTop + thick, zB + thick, 0, yBot - thick, zB + thick);
  pop(); gl.depthFunc(gl.LESS);
}

function drawBracing() {
  let gl = drawingContext; gl.depthFunc(gl.LEQUAL);
  push(); noFill(); stroke(...C_BRACE); strokeWeight(THIN_WT);
  let z = BODY_D / 2 - 1, yBot = G.yBot;
  line(-130, yBot * 0.7, z, 100, NK_Y0 * 0.7, z);
  line( 130, yBot * 0.7, z, -100, NK_Y0 * 0.7, z);
  strokeWeight(HAIR_WT);
  line(-120, SH_CY + SH_R + 20, z,  120, SH_CY + SH_R + 20, z);
  line(-100, SH_CY - SH_R - 15, z,  100, SH_CY - SH_R - 15, z);
  for (let i = -2; i <= 2; i++) { let a = i * 0.15; line(sin(a) * 20, 60, z, sin(a) * 140, yBot * 0.9, z); }
  pop(); gl.depthFunc(gl.LESS);
}

function drawDepthRibs() {
  let gl = drawingContext; gl.depthFunc(gl.LEQUAL);
  push(); noFill(); stroke(...C_DIM, 180); strokeWeight(HAIR_WT);
  let zF = BODY_D / 2, zB = -BODY_D / 2;

  // Body: rectangular cross-section contours at Y stations
  const N_STATIONS = 10;
  for (let s = 1; s < N_STATIONS; s++) {
    let y  = G.yBot - (G.yBot - G.yTop) * (s / N_STATIONS);
    let rx = bodyWidthAt(y);
    if (rx < 0.5) continue;
    beginShape();
    vertex(-rx, y, zF); vertex(rx, y, zF); vertex(rx, y, zB); vertex(-rx, y, zB);
    endShape(CLOSE);
  }

  // Body: silhouette depth connectors
  let step = Math.floor(bodyPts.length / 32);
  for (let i = 0; i < bodyPts.length; i += step) {
    let p = bodyPts[i];
    line(p.x, p.y, zF, p.x, p.y, zB);
  }
  pop();

  // Neck + headstock cross-sections (matching neckOX/neckOZ offset)
  push(); translate(G.neckOX, 0, G.neckOZ);
  noFill(); stroke(...C_DIM, 180); strokeWeight(HAIR_WT);
  const { w0, w1, d0, d1 } = neckDims();
  const N_NECK = 6;
  for (let s = 1; s < N_NECK; s++) {
    let t = s / N_NECK;
    let y = lerp(NK_Y0, NK_Y1, t);
    let w = lerp(w0, w1, t);
    let d = lerp(d0, d1, t);
    beginShape();
    vertex(-w, y, d); vertex(w, y, d); vertex(w, y, -d); vertex(-w, y, -d);
    endShape(CLOSE);
  }

  push(); translate(0, NK_Y1, 0); rotateX(HD_ANG);
  let hw = HD_W / 2, hd = HD_D / 2;
  const N_HS = 3;
  for (let s = 1; s < N_HS; s++) {
    let y = -HD_LEN * (s / N_HS);
    beginShape();
    vertex(-hw, y, hd); vertex(hw, y, hd); vertex(hw, y, -hd); vertex(-hw, y, -hd);
    endShape(CLOSE);
  }
  pop();
  pop();

  gl.depthFunc(gl.LESS);
}
