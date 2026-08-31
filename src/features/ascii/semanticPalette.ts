// ---------------------------------------------------------------------------
// Semantic Character Palettes
// ---------------------------------------------------------------------------
// Content-aware character selection: each category lists 5 atlas indices
// ordered light → dark.  The shader classifies each cell by HSV into a
// category, then picks a stop based on darkness.
//
// Rooted in:
//   Nelson, Artyping (1939)   — canonical . : I V N/M density ramp (NEUTRAL)
//   Neill (1982)              — single-letter backgrounds + overstrike density
//   Franca (~2014)            — 4-letter portrait palette i o x m (SKIN)
//   Cook, Stark, alt-FAQ, DF  — contemporary character-per-texture conventions
//
// 15 categories total.  Adding another is data-only: append to the palette
// array, bump the category constant, and add a classifier branch.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { ATLAS_CHARS } from './constants';

// Look up an atlas index by character literal at build time.
const idx = (ch: string): number => {
  const i = ATLAS_CHARS.indexOf(ch);
  if (i < 0) throw new Error(`semanticPalette: char "${ch}" missing from atlas`);
  return i;
};

// Category IDs — must match the integer returned by classifyCell() in the shader.
export const CAT_GRASS   = 0;
export const CAT_WATER   = 1;
export const CAT_SKY     = 2;
export const CAT_TREE    = 3;
export const CAT_ROCK    = 4;
export const CAT_NEUTRAL = 5;
export const CAT_SAND    = 6;
export const CAT_DIRT    = 7;
export const CAT_FIRE    = 8;
export const CAT_SMOKE   = 9;
export const CAT_SKIN    = 10;
export const CAT_HAIR    = 11;
export const CAT_FABRIC  = 12;
export const CAT_FUR     = 13;
export const CAT_METAL   = 14;

// Each entry is a 5-stop ramp, light → dark.
// NEUTRAL uses the Nelson 1939 ramp — canonical typewriter skin/face shading.
// SKIN uses a Franca-adapted ramp (lowercase i not in atlas → substituted `.`).
export const SEMANTIC_PALETTES: number[][] = [
  [idx(','), idx('`'), idx('"'), idx('v'), idx('w')],   //  0 GRASS   blades pointing up
  [idx('.'), idx('_'), idx('-'), idx('~'), idx('=')],   //  1 WATER   horizontal strokes
  [idx(' '), idx('.'), idx("'"), idx('`'), idx('~')],   //  2 SKY     sparse top-of-cell
  [idx('^'), idx('*'), idx('&'), idx('%'), idx('#')],   //  3 TREE    pine tips → dense canopy
  [idx('.'), idx('*'), idx('o'), idx('O'), idx('#')],   //  4 ROCK    stipple → boulder
  [idx('.'), idx(':'), idx('I'), idx('V'), idx('M')],   //  5 NEUTRAL Nelson 1939 ramp
  [idx('.'), idx(','), idx(':'), idx(';'), idx('`')],   //  6 SAND    fine → coarse stipple
  [idx('.'), idx(','), idx(';'), idx('*'), idx('#')],   //  7 DIRT    stipple → packed
  [idx("'"), idx('*'), idx('^'), idx('&'), idx('@')],   //  8 FIRE    ember → hot core
  [idx('.'), idx('o'), idx('O'), idx('~'), idx('#')],   //  9 SMOKE   wisp → billow
  [idx('.'), idx('o'), idx('x'), idx('m'), idx('@')],   // 10 SKIN    Franca-adapted
  [idx("'"), idx('|'), idx('/'), idx('\\'), idx('M')],  // 11 HAIR    thin strand → dense
  [idx("'"), idx(')'), idx('('), idx('/'), idx('\\')],  // 12 FABRIC  fold / drape (Nelson)
  [idx(','), idx(':'), idx('~'), idx('M'), idx('#')],   // 13 FUR     short tuft → dense pelt
  [idx('-'), idx('_'), idx('|'), idx('='), idx('#')],   // 14 METAL   polished lines → plate
];

export const SEMANTIC_CATEGORY_COUNT = SEMANTIC_PALETTES.length;
export const SEMANTIC_RAMP_STOPS     = 5;

// Atlas index of 'M' — used by the Neill overstrike pass.
export const NEILL_OVERSTRIKE_CHAR_IDX = idx('M');

// ---------------------------------------------------------------------------
// buildSemanticPaletteTexture
// ---------------------------------------------------------------------------
// Packs SEMANTIC_PALETTES into a 1×N DataTexture.  The shader reads:
//   atlasIdx = texture2D(uSemanticPalette,
//                        vec2((cat*5 + stop + 0.5) / width, 0.5)).r * 255
// ---------------------------------------------------------------------------
export function buildSemanticPaletteTexture(): { texture: THREE.DataTexture; width: number } {
  const width = SEMANTIC_CATEGORY_COUNT * SEMANTIC_RAMP_STOPS;
  const data  = new Uint8Array(width);

  for (let c = 0; c < SEMANTIC_CATEGORY_COUNT; c++) {
    for (let s = 0; s < SEMANTIC_RAMP_STOPS; s++) {
      data[c * SEMANTIC_RAMP_STOPS + s] = SEMANTIC_PALETTES[c][s];
    }
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  texture.minFilter       = THREE.NearestFilter;
  texture.magFilter       = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate     = true;

  return { texture, width };
}
