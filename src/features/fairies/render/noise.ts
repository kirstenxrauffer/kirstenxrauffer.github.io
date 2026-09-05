// 3D Perlin noise — the one p5 utility the fairy layer genuinely needed.
//
// `p.noise` had exactly one caller: behavior.fsm.ts:671, which uses it to pick a
// wander heading from (x, y, time, seed). The FSM was already written to take an
// injected `NoiseFn` rather than importing p5 ("No p5 imports — takes a noise
// function instead"), so this drops straight into that seam.
//
// Matches p5's contract where it matters: returns [0, 1], smooth and continuous,
// with 4 octaves at 0.5 amplitude falloff (p5's defaults). The underlying
// gradient function is classic Perlin rather than p5's value-noise variant, so
// the exact field differs — the wander path is a different random walk, not a
// worse one.

const OCTAVES = 4;
const FALLOFF = 0.5;

// Permutation table, doubled to avoid an index wrap in the lookups below.
const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Deterministic shuffle — a fixed field means the fairy's wander is
  // reproducible across reloads, matching p5's fixed default seed.
  let s = 1013904223;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + t * (b - a);

function grad(hash: number, x: number, y: number, z: number): number {
  // 12 gradient directions on the cube edges (Perlin's improved set).
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Single-octave classic Perlin, range roughly [-1, 1]. */
function perlin3(x: number, y: number, z: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const zi = Math.floor(z) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const zf = z - Math.floor(z);

  const u = fade(xf), v = fade(yf), w = fade(zf);

  const a  = PERM[xi] + yi;
  const aa = PERM[a] + zi;
  const ab = PERM[a + 1] + zi;
  const b  = PERM[xi + 1] + yi;
  const ba = PERM[b] + zi;
  const bb = PERM[b + 1] + zi;

  return lerp(
    lerp(
      lerp(grad(PERM[aa],     xf,     yf,     zf),     grad(PERM[ba],     xf - 1, yf,     zf),     u),
      lerp(grad(PERM[ab],     xf,     yf - 1, zf),     grad(PERM[bb],     xf - 1, yf - 1, zf),     u),
      v,
    ),
    lerp(
      lerp(grad(PERM[aa + 1], xf,     yf,     zf - 1), grad(PERM[ba + 1], xf - 1, yf,     zf - 1), u),
      lerp(grad(PERM[ab + 1], xf,     yf - 1, zf - 1), grad(PERM[bb + 1], xf - 1, yf - 1, zf - 1), u),
      v,
    ),
    w,
  );
}

/**
 * Fractal Perlin in [0, 1] — the drop-in for `p.noise(x, y, z)`.
 */
export function noise(x: number, y: number, z = 0): number {
  let total = 0;
  let amp = 1;
  let max = 0;
  let fx = x, fy = y, fz = z;
  for (let i = 0; i < OCTAVES; i++) {
    total += perlin3(fx, fy, fz) * amp;
    max += amp;
    amp *= FALLOFF;
    fx *= 2; fy *= 2; fz *= 2;
  }
  // perlin3 spans about [-1, 1]; fold to [0, 1] and clamp against the tails.
  return Math.min(1, Math.max(0, (total / max) * 0.5 + 0.5));
}
