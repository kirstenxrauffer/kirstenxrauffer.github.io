// Petal instance data — palette, seeded RNG, per-instance buffer generation.
//
// All 8 slots are reds and pinks.  The fragment shader desaturates 30 % and
// the watercolor composite darkens slightly via Bousseau density, so palette
// values are kept fully saturated to survive those passes with vivid color.

export const PETAL_PALETTE: [number, number, number][] = [
  [0xFF, 0x33, 0x33], // bright red
  [0xFF, 0x44, 0x66], // vivid rose-red
  [0xFF, 0x22, 0x44], // saturated crimson
  [0xFF, 0x55, 0x77], // bright rose-pink
  [0xFF, 0xAA, 0xBB], // light pink
  [0xFF, 0xCC, 0xD8], // pale blush
  [0xFF, 0x77, 0x88], // warm coral-pink
  [0xFF, 0x88, 0x99], // medium pink
];

export const MAX_PETALS    = 6;
export const LIFE_DURATION = 16.0; // seconds per petal lifecycle — long enough to drift across the viewport

// Linear-congruential PRNG — same as sister site for reproducibility
function makeRng(seed: number) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export interface PetalBuffers {
  spawnPositions:    Float32Array; // count × 3  [x, y, z]
  birthLifeSeedScale: Float32Array; // count × 4  [birthTime, lifeDuration, seed, scale]
  colorIndices:      Float32Array; // count × 1  [colorIndex]
}

export function buildPetalData(count: number, seed: number): PetalBuffers {
  const rng = makeRng(seed);

  const spawnPositions     = new Float32Array(count * 3);
  const birthLifeSeedScale = new Float32Array(count * 4);
  const colorIndices       = new Float32Array(count);

  const half = Math.floor(count / 2);

  for (let i = 0; i < count; i++) {
    // All petals spawn from the left edge (x ≈ -100 maps to uSpawnX, the left viewport boundary).
    // Births are staggered so at any time 20 petals are spread across their journey left → right.
    spawnPositions[i * 3]     = -(95 + rng() * 5);  // x ∈ [-100, -95] — remapped by uSpawnX in vertex shader
    spawnPositions[i * 3 + 1] = rng() * 16 + 14;    // y ∈ [14, 30] — matches visible Y frustum at z=[75,88], cam y=22
    spawnPositions[i * 3 + 2] = rng() * 4 + 72;     // z ∈ [72, 76] — 24–28 units from camera

    // Stagger births evenly so all slots are populated by the first cycle end
    birthLifeSeedScale[i * 4]     = (i / count) * LIFE_DURATION;
    birthLifeSeedScale[i * 4 + 1] = LIFE_DURATION;
    birthLifeSeedScale[i * 4 + 2] = rng();
    // First half: small [0.825, 1.125]; second half: medium [1.2, 1.5]  (25% smaller than original)
    birthLifeSeedScale[i * 4 + 3] = i < half
      ? 0.825 + rng() * 0.3
      : 1.2   + rng() * 0.3;

    colorIndices[i] = Math.floor(rng() * PETAL_PALETTE.length);
  }

  return { spawnPositions, birthLifeSeedScale, colorIndices };
}
