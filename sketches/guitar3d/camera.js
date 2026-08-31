// ── Camera state ───────────────────────────────────────────────────────────
let cam;
let camSrcEye = null, camSrcLook = null;
let camDstEye = null, camDstLook = null;
let camLerpT    = 1;
let prevZoomId  = null;

// ── Camera target per component ────────────────────────────────────────────

function camTargetFor(id) {
  const dist = 700;
  const T    = y => y + 120;                      // matches translate(0, 120, 0)
  const mid  = T((G.yTop + G.yBot) / 2);
  const brY  = T(BR_Y);
  const nkMid = T((NK_Y0 + NK_Y1) / 2);
  const nkTop  = T(NK_Y1);
  const hdMid  = T(NK_Y1 - 70);                   // rough headstock center

  // Angled 3/4 view — offsets the camera off the dead-on axis so stacked
  // layers (fretboard / frets / strings / pegs) separate visually instead of
  // z-fighting. ~36° off-axis, slight downward tilt for depth cue.
  const A  = Math.PI / 5;
  const sA = Math.sin(A), cA = Math.cos(A);
  const pitch = 0.15;
  const front = (y, r) => ({ eye: [r * sA,  y - r * pitch,  r * cA], look: [0, y, 0] });
  const back  = (y, r) => ({ eye: [-r * sA, y - r * pitch, -r * cA], look: [0, y, 0] });

  switch (id) {
    case 'soundboard':  return front(mid,    dist);
    case 'back':        return back (mid,    dist);
    case 'sides':       return { eye: [dist * cA, mid - dist * pitch, dist * sA], look: [0, mid, 0] };
    case 'bridge':      return front(brY,    dist * 0.5);
    case 'neck':        return front(nkMid,  dist * 0.7);
    case 'fretboard':   return front(nkMid,  dist * 0.7);
    case 'frets':       return front(nkMid,  dist * 0.5);
    case 'headstock':   return front(hdMid,  dist * 0.5);
    case 'tuning_pegs': return front(hdMid,  dist * 0.4);
    case 'nut':         return front(nkTop,  dist * 0.4);
    case 'strings':     return front(mid,    dist * 0.9);
  }
  return null;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Shortest signed yaw delta in (-π, π]. At an exact 180° flip the math is
// ambiguous; bias to +π (counter-clockwise from above) so the camera always
// orbits past the +X side of the guitar rather than tunneling through it.
function shortestYawDelta(src, dst) {
  let d = (dst - src) % (2 * Math.PI);
  if (d >  Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  if (Math.abs(Math.abs(d) - Math.PI) < 1e-4 && d < 0) d = Math.PI;
  return d;
}

function updateCameraForHover() {
  if (zoomTargetId !== prevZoomId) {
    prevZoomId = zoomTargetId;
    if (zoomTargetId) {
      const dst = camTargetFor(zoomTargetId);
      if (dst) {
        camSrcEye  = [cam.eyeX,    cam.eyeY,    cam.eyeZ];
        camSrcLook = [cam.centerX, cam.centerY, cam.centerZ];
        camDstEye  = dst.eye;
        camDstLook = dst.look;
        camLerpT   = 0;
      }
    }
  }
  if (camDstEye && camLerpT < 1) {
    camLerpT = Math.min(1, camLerpT + 0.04);
    const t = easeInOutCubic(camLerpT);

    const lx = lerp(camSrcLook[0], camDstLook[0], t);
    const ly = lerp(camSrcLook[1], camDstLook[1], t);
    const lz = lerp(camSrcLook[2], camDstLook[2], t);

    // Spherical-interp the eye around the look point so a 180° flip arcs
    // around the guitar (via the +X side) instead of cutting through it.
    const sox = camSrcEye[0] - camSrcLook[0];
    const soy = camSrcEye[1] - camSrcLook[1];
    const soz = camSrcEye[2] - camSrcLook[2];
    const dox = camDstEye[0] - camDstLook[0];
    const doy = camDstEye[1] - camDstLook[1];
    const doz = camDstEye[2] - camDstLook[2];
    const sr = Math.hypot(sox, soy, soz);
    const dr = Math.hypot(dox, doy, doz);
    const sYaw   = Math.atan2(sox, soz);
    const dYaw   = sYaw + shortestYawDelta(sYaw, Math.atan2(dox, doz));
    const sPitch = Math.asin(Math.max(-1, Math.min(1, soy / Math.max(sr, 1e-6))));
    const dPitch = Math.asin(Math.max(-1, Math.min(1, doy / Math.max(dr, 1e-6))));

    const r     = lerp(sr, dr, t);
    const yaw   = lerp(sYaw, dYaw, t);
    const pitch = lerp(sPitch, dPitch, t);
    const cp    = Math.cos(pitch);

    cam.setPosition(lx + r * cp * Math.sin(yaw),
                    ly + r * Math.sin(pitch),
                    lz + r * cp * Math.cos(yaw));
    cam.lookAt(lx, ly, lz);
  }
}
