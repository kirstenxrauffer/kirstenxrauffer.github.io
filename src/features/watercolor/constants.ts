// ---------------------------------------------------------------------------
// Hero image pool — randomly selected on every pageload/navigation.
// Paths are relative to publicDir (assets/ → served at /).
// ---------------------------------------------------------------------------
export const HERO_IMAGES = [
  '/images/IMG_0005.jpg',
  '/images/IMG_1567.jpg',
  '/images/IMG_1941.jpg',
  '/images/IMG_2406.jpg',
  '/images/IMG_4597.jpg',
  '/images/IMG_4607.jpg',
  '/images/IMG_5002.jpg',
  '/images/IMG_5004.jpg',
  '/images/IMG_5007.jpg',
  '/images/IMG_5009.jpg',
  '/images/IMG_5010.jpg',
  '/images/IMG_5012.jpg',
  '/images/IMG_6372.jpg',
  '/images/IMG_9361.jpg',
];

// ---------------------------------------------------------------------------
// Pre-blur pass count.
// Each pass runs the Kuwahara filter on the output of the previous pass,
// compounding abstraction before the reveal animation begins.
// Increase for more painterly abstraction; 0 disables pre-blurring entirely.
// ---------------------------------------------------------------------------
export const N_PRE_BLUR = 3;

// ---------------------------------------------------------------------------
// Reveal animation
// REVEAL_PROGRESS_TARGET controls how far the reveal front sweeps.
// Phase B saturation has been removed — the front freezes in place with its
// organic fBm-warped boundary visible on the edges.  At 0.9 the ring sits at
// front ≈ 0.73, which lands on the visible screen edges (not off-screen).
// ---------------------------------------------------------------------------
export const REVEAL_DURATION = 15;
export const REVEAL_PROGRESS_TARGET = .65;

// ---------------------------------------------------------------------------
// Locked-in shader uniform defaults.
// ---------------------------------------------------------------------------
export const UNIFORM_DEFAULTS = {
  warpInfluence:  0.26,
  revealSpread:   0.18,
  ringHalfwidth:  0.019,
  ringStrength:   0.09,
  densityWeights: [0.0, 0.0, 0, 0.0] as [number, number, number, number],
  beta:           0.46,
  fiberStrength:  0.14,
  fiberScale:     8.0,
  abstraction:    22.0,
  blotchiness:    0.12,
  wobbleStrength: 0,
  warpDisplace:   0.0,
};
