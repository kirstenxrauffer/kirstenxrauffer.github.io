// ── View toggles ───────────────────────────────────────────────────────────
let sectionOn   = false;
let internalsOn = false;
let wireOn      = false;

// ── p5 lifecycle ───────────────────────────────────────────────────────────

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  buildSliders();
  rebuildFromParams();
  buildHole();

  // Initial camera: angled 3/4 view, zoomed in closer
  cam = createCamera();
  cam.setPosition(380, -120, 520);
  cam.lookAt(0, 0, 0);

  setupPick();
  initGrain();
  initSideGrain();
}

function draw() {
  clear();
  let sc = min(width, height) / 900;  // more zoomed in
  scale(sc);
  // Manual orbit available unless a camera zoom is committed. Using
  // zoomTargetId (committed) rather than hoveredId (instant) means a cursor
  // grazing a thin part doesn't yank orbit out from under the user.
  if (!zoomTargetId) orbitControl(2, 2, 0.3);
  translate(0, 120, 0);

  // Subtle noise-driven auto-rotation (inspired by openprocessing #2900727).
  // Paused only when the camera is committed to a zoom target — so the
  // framing holds still after commitment, but keeps drifting for transient
  // hovers that never commit.
  let tRot   = millis() / 1000 / 11;
  let rotAmp = 0.3;  // ±~8.6° on each axis
  if (!zoomTargetId) {
    rotateX((noise(1 + tRot) - 0.5) * rotAmp);
    rotateY((noise(2 + tRot) - 0.5) * rotAmp);
    rotateZ((noise(3 + tRot) - 0.5) * rotAmp);
  }

  updateExplodeT();

  // Skip depth mask while exploded (mask geometry is at home positions and
  // would occlude pieces that have moved away).
  if (explodeT < 0.01) drawDepthMask();

  drawAllComponents();

  if (sectionOn)   drawSectionEdges();
  if (internalsOn) drawBracing();
  if (wireOn)      drawDepthRibs();

  // ── Pick pass (separate canvas, same transforms) ──
  runPickPass(sc, tRot, rotAmp);
  // Freeze hover resolution while the camera is mid-lerp. Prevents the
  // mid-zoom cursor-drift bug: as the camera flies in, different geometry
  // swims under the stationary cursor and would otherwise re-target the
  // camera, causing oscillation. Picking resumes on the frame the lerp ends.
  if (camLerpT >= 1) {
    hoveredId = readPickAtMouse();
    updateZoomTarget();
  }
  updateHoverHud();
  updateCameraForHover();
}

// ── Input ──────────────────────────────────────────────────────────────────

function keyPressed() {
  if (key === 's' || key === 'S') sectionOn   = !sectionOn;
  if (key === 'i' || key === 'I') internalsOn = !internalsOn;
  if (key === 'w' || key === 'W') wireOn      = !wireOn;
  if (key === 'p' || key === 'P') {
    pickDebug = !pickDebug;
    if (pickGfx) pickGfx.canvas.style.display = pickDebug ? 'block' : 'none';
  }
  if (key === 'r' || key === 'R') { sectionOn = false; internalsOn = false; wireOn = false; }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (pickGfx) pickGfx.resizeCanvas(windowWidth, windowHeight);
}
