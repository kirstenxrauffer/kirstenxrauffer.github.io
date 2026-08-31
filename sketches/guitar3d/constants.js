// ── Color palettes ─────────────────────────────────────────────────────────
const C_BG      = [18, 18, 32];
const C_LINE    = [40, 38, 32];
const C_DIM     = [120, 115, 105];
const C_STR     = [110, 100, 90];
const C_STR_INV = [235, 228, 210];
const C_FRET    = [160, 155, 150];
const C_BRACE   = [170, 150, 110];
const C_WOOD    = [245, 245, 220];  // matches page bg (CSS beige)

// ── Stroke weights ─────────────────────────────────────────────────────────
const EDGE_WT = 2.0, THIN_WT = 1.2, HAIR_WT = 0.6;

// ── Polygon segment counts ─────────────────────────────────────────────────
const HOLE_SEGS    = 60;   // soundhole / rosette
const PEG_SEGS     = 16;   // tuning peg / inlay dot
const STRING_SEGS  = 40;   // string color-segment count
const BODY_SAMPLES = 500;  // body outline polygon resolution

// ── Back grain buffer (body face) ─────────────────────────────────────────
const GRAIN_BUF_W = 256;
const GRAIN_BUF_H = 512;

// ── Side grain buffer (tall/narrow, 1:12 matches ribbon aspect ratio) ──────
const SIDE_GRAIN_BUF_W = 64;
const SIDE_GRAIN_BUF_H = 768;

// ── Guitar structural constants ────────────────────────────────────────────
const HD_LEN = 110, HD_D = 16;          // headstock length / half-depth
const HD_ANG = Math.PI / 12;            // headstock tilt angle
const N_STR  = 6,   N_FRET = 20;
const STR_SP_BR = 50, STR_SP_NT = 34;  // string spread at bridge / nut
const FB_THICK  = 6;                    // fretboard thickness
const SAD_W = 80, SAD_H = 4, SAD_D = 3; // saddle dims
const NUT_H = 4,  NUT_D = 3;           // nut dims (NUT_W is derived)
const BR_W  = 100, BR_H = 12, BR_D = 8; // bridge dims (BR_Y is derived)

// ── Component registry (single-channel R picking: fill(pickId,0,0)) ────────
const COMPONENTS = [
  { id: 'soundboard',  label: 'soundboard',  pickId: 10  },
  { id: 'back',        label: 'back',        pickId: 20  },
  { id: 'sides',       label: 'sides',       pickId: 30  },
  { id: 'bridge',      label: 'bridge',      pickId: 40  },
  { id: 'neck',        label: 'neck',        pickId: 50  },
  { id: 'fretboard',   label: 'fretboard',   pickId: 60  },
  { id: 'frets',       label: 'frets',       pickId: 70  },
  { id: 'headstock',   label: 'headstock',   pickId: 80  },
  { id: 'tuning_pegs', label: 'tuning pegs', pickId: 90  },
  { id: 'nut',         label: 'nut',         pickId: 100 },
  { id: 'strings',     label: 'strings',     pickId: 110 },
];
const PICK_BY_R  = new Map(COMPONENTS.map(c => [c.pickId, c.id]));
const PICK_BY_ID = new Map(COMPONENTS.map(c => [c.id, c.pickId]));

// ── Slider parameters (defaults = current shape) ───────────────────────────
const PARAMS = {
  bodyHeight:    { val: 290,  min: 50,   max: 1000, step: 5,    label: 'body height' },
  lowerBoutW:    { val: 107,  min: 10,   max: 400,  step: 1,    label: 'lower bout width' },
  upperBoutW:    { val: 83,   min: 10,   max: 350,  step: 1,    label: 'upper bout width' },
  waistW:        { val: 74,   min: 5,    max: 350,  step: 1,    label: 'waist width' },
  waistPos:      { val: 0.57, min: 0.05, max: 0.95, step: 0.01, label: 'waist position' },
  lowerBoutH:    { val: 0.54, min: 0.10, max: 0.95, step: 0.01, label: 'lower bout height' },
  bodyDepth:     { val: 55,   min: 5,    max: 300,  step: 5,    label: 'body depth' },
  neckLength:    { val: 275,  min: 50,   max: 800,  step: 5,    label: 'neck length' },
  bottomRound:   { val: 1.15, min: 0.0,  max: 2.0,  step: 0.05, label: 'bottom roundness' },
  neckJunction:  { val: 1.0,  min: 0.0,  max: 3.0,  step: 0.05, label: 'neck junction curve' },
  upperBoutPos:  { val: 1.11, min: 0.10, max: 4.0,  step: 0.01, label: 'upper bout position' },
  waistHeight:   { val: 60,   min: 1,    max: 300,  step: 1,    label: 'waist height' },
  soundHoleR:    { val: 33,   min: 5,    max: 150,  step: 1,    label: 'sound hole radius' },
  neckWidthBody: { val: 38,   min: 5,    max: 150,  step: 1,    label: 'neck width (body)' },
  neckWidthNut:  { val: 31,   min: 5,    max: 120,  step: 1,    label: 'neck width (nut)' },
  neckDepth:     { val: 37,   min: 5,    max: 100,  step: 1,    label: 'neck depth' },
  neckOffsetX:   { val: 0,    min: -100, max: 100,  step: 1,    label: 'neck offset X' },
  neckOffsetY:   { val: 0,    min: -150, max: 150,  step: 1,    label: 'neck offset Y' },
  neckOffsetZ:   { val: 9,    min: -100, max: 100,  step: 1,    label: 'neck offset Z' },
  headstockW:    { val: 47,   min: 10,   max: 200,  step: 1,    label: 'headstock width' },
  fretboardExtra:{ val: 0,    min: 0,    max: 30,   step: 1,    label: 'fretboard overhang' },
  shoulderSharp: { val: 4,    min: 0.5,  max: 25,   step: 0.5,  label: 'shoulder sharpness' },
  waistSharp:    { val: 1.2,  min: 0.1,  max: 8.0,  step: 0.1,  label: 'waist sharpness' },
  lowerBoutSharp:{ val: 0.6,  min: 0.1,  max: 8.0,  step: 0.1,  label: 'lower bout sharpness' },
  shoulderSmooth:{ val: 0.02, min: 0,    max: 0.4,  step: 0.01, label: 'shoulder corner fade' },
};

// ── Presets ────────────────────────────────────────────────────────────────
const PRESETS = {
  dreadnought: { bodyHeight: 520, lowerBoutW: 165, upperBoutW: 128, waistW: 105, waistPos: 0.50, lowerBoutH: 0.58, bodyDepth: 110, neckLength: 350, bottomRound: 0.85, neckJunction: 0.85, upperBoutPos: 0.55, waistHeight: 50, soundHoleR: 50, neckWidthBody: 56, neckWidthNut: 44, headstockW: 74, fretboardExtra: 2, shoulderSharp: 8, waistSharp: 1.0, lowerBoutSharp: 1.0 },
  concert:     { bodyHeight: 385, lowerBoutW: 127, upperBoutW: 87,  waistW: 95,  waistPos: 0.56, lowerBoutH: 0.57, bodyDepth: 80,  neckLength: 360, bottomRound: 1.0,  neckJunction: 1.0,  upperBoutPos: 0.81, waistHeight: 40, soundHoleR: 50, neckWidthBody: 56, neckWidthNut: 44, headstockW: 74, fretboardExtra: 2, shoulderSharp: 8, waistSharp: 1.0, lowerBoutSharp: 1.0 },
  jumbo:       { bodyHeight: 540, lowerBoutW: 195, upperBoutW: 158, waistW: 118, waistPos: 0.52, lowerBoutH: 0.58, bodyDepth: 120, neckLength: 340, bottomRound: 0.9,  neckJunction: 0.8,  upperBoutPos: 0.50, waistHeight: 55, soundHoleR: 55, neckWidthBody: 58, neckWidthNut: 46, headstockW: 78, fretboardExtra: 2, shoulderSharp: 8, waistSharp: 1.0, lowerBoutSharp: 1.0 },
  parlor:      { bodyHeight: 420, lowerBoutW: 138, upperBoutW: 118, waistW: 95,  waistPos: 0.53, lowerBoutH: 0.58, bodyDepth: 80,  neckLength: 300, bottomRound: 0.9,  neckJunction: 0.9,  upperBoutPos: 0.55, waistHeight: 35, soundHoleR: 42, neckWidthBody: 52, neckWidthNut: 42, headstockW: 68, fretboardExtra: 2, shoulderSharp: 8, waistSharp: 1.0, lowerBoutSharp: 1.0 },
  classical:   { bodyHeight: 500, lowerBoutW: 162, upperBoutW: 150, waistW: 108, waistPos: 0.52, lowerBoutH: 0.56, bodyDepth: 95,  neckLength: 290, bottomRound: 0.9,  neckJunction: 0.9,  upperBoutPos: 0.55, waistHeight: 45, soundHoleR: 48, neckWidthBody: 60, neckWidthNut: 52, headstockW: 76, fretboardExtra: 3, shoulderSharp: 8, waistSharp: 1.0, lowerBoutSharp: 1.0 },
};
