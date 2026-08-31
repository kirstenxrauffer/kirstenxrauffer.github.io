// ---------------------------------------------------------------------------
// ASCII Art Shader — Constants & Character Data
// ---------------------------------------------------------------------------

// Density ramp: characters sorted lightest → darkest by visual ink coverage.
// The shader maps image darkness (1 - luminance) to an index in this ramp.
export const DENSITY_CHARS =
  " .',:;-~!+*=cxzoLTJ0Okd#MW&@$BN%Q";
//  0         1         2         3
//  012345678901234567890123456789012
// 33 characters in the density ramp

// Edge / contour characters — stored after the density ramp.
// The shader picks from these based on gradient direction.
export const EDGE_CHARS = '/\\|-=[]()!7';
//                         0  1 2 3 4 56 78 9 10
// 11 characters.  Atlas indices: DENSITY_SIZE + 0..10 = 33..43

export const DENSITY_SIZE = DENSITY_CHARS.length;  // 33
export const EDGE_OFFSET  = DENSITY_SIZE;          // 33

// Texture-matched characters — stored after edge chars.
// Smooth surfaces: round/solid characters with good surface coverage.
// Bumpy/rough textures: angular, multi-stroke characters.
// Organic/flowing: curved, natural-feeling characters.
//
//  Smooth (0-4):  D  Q  b  p  G      ← round, solid fill
//  Bumpy  (5-9):  m  n  v  w  r      ← angular, multi-stroke
//  Organic(10-14): s  e  g  a  u     ← curved, flowing
export const TEXTURE_CHARS = 'DQbpGmnvwrsegau';
// 15 characters.  Atlas indices: TEXTURE_OFFSET + 0..14 = 44..58

export const TEXTURE_OFFSET = EDGE_OFFSET + EDGE_CHARS.length;  // 44

// Semantic-category glyphs — content-aware texture mapping.
//   ` (backtick) — grass / sand (low density, top-of-cell per Stark slope rules)
//   _            — water / wood / snow ground
//   ^            — mountain peak / conifer tip / grass tuft
//   < >          — scales, beaks, directional markers
//   { }          — organic curves, rose petals (jgs tradition)
//   "            — grass tuft / cirrus cloud (top-of-cell pair with ' per Stark)
//
// Rooted in Nelson (Artyping, 1939), Neill (1982), and Stark slope grammar.
export const SEMANTIC_CHARS = '`_^<>{}"';
// 8 characters.  Atlas indices: SEMANTIC_OFFSET + 0..7 = 59..66

export const SEMANTIC_OFFSET = TEXTURE_OFFSET + TEXTURE_CHARS.length;  // 59

// Uppercase alphabet appended last for word rendering.
export const WORD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// 26 characters.  Atlas indices: WORD_OFFSET + 0..25 = 67..92

export const WORD_OFFSET = SEMANTIC_OFFSET + SEMANTIC_CHARS.length;  // 67

// Full atlas character list (density + edge + texture + semantic + alphabet).
export const ATLAS_CHARS = DENSITY_CHARS + EDGE_CHARS + TEXTURE_CHARS + SEMANTIC_CHARS + WORD_CHARS;

// Atlas grid layout — 93 chars total → 10×10 grid (100 slots).
export const ATLAS_COLS = 10;
export const ATLAS_ROWS = 10;

// Individual character cell size in the atlas texture (pixels).
// Sized for Courier New at ~18px — crisp at typical screen resolutions.
export const CHAR_PX_W = 24;
export const CHAR_PX_H = 30;

// Nature-themed easter-egg words hidden along edge contours.
export const EASTER_EGG_WORDS = [
  'BLOOM', 'GROW',  'WILD',  'ROOT',  'LEAF',
  'RAIN',  'SEED',  'MOSS',  'FERN',  'BARK',
  'WIND',  'SOIL',  'POND',  'HILL',  'DUSK',
  'DAWN',  'MIST',  'VINE',  'ROSE',  'PINE',
];

export const WORD_MAX_LEN = 5;  // longest word in the list

// Default shader uniforms
export const ASCII_DEFAULTS = {
  cellSize:         8.5,       // px — character cell width on screen (smaller = more detail)
  tolerance:        0.05,    // detail threshold (lower = fill chars activate across more of the tonal range)
  scrambleDuration: 7.0,     // seconds for scramble animation
};

// Reuse the same hero image pool as the watercolor shader.
export { HERO_IMAGES } from '../watercolor/constants';
