// ---------------------------------------------------------------------------
// Font Atlas Generator
// ---------------------------------------------------------------------------
// Renders all characters used by the ASCII art shader into a single canvas
// texture.  Characters are laid out in a row-major grid matching ATLAS_COLS
// × ATLAS_ROWS.  The shader samples this texture to display glyphs.
//
// Also builds a 1D word-data texture that encodes the easter-egg words as
// sequences of atlas indices.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import {
  ATLAS_CHARS,
  ATLAS_COLS,
  ATLAS_ROWS,
  CHAR_PX_W,
  CHAR_PX_H,
  EASTER_EGG_WORDS,
  WORD_MAX_LEN,
  WORD_OFFSET,
} from './constants';

// ---------------------------------------------------------------------------
// buildFontAtlas
// ---------------------------------------------------------------------------
// Returns a THREE.CanvasTexture containing all glyphs.  Each character is
// rendered white-on-black into a grid cell, so the shader can sample the
// red channel as glyph alpha (1 = ink, 0 = paper).
// ---------------------------------------------------------------------------
export function buildFontAtlas(): THREE.CanvasTexture {
  const atlasW = ATLAS_COLS * CHAR_PX_W;   // 128
  const atlasH = ATLAS_ROWS * CHAR_PX_H;   // 208

  const canvas = document.createElement('canvas');
  canvas.width  = atlasW;
  canvas.height = atlasH;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, atlasW, atlasH);

  // Use a monospace font.  Courier New is universally available and gives
  // the authentic typewriter aesthetic.
  const fontSize = Math.floor(CHAR_PX_H * 0.77);
  ctx.font         = `${fontSize}px "Courier New", "Courier", monospace`;
  ctx.fillStyle    = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign    = 'center';

  for (let i = 0; i < ATLAS_CHARS.length; i++) {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    const cx  = col * CHAR_PX_W + CHAR_PX_W / 2;
    const cy  = row * CHAR_PX_H + CHAR_PX_H / 2;
    const m   = ctx.measureText(ATLAS_CHARS[i]);
    // Center by actual rendered bounds, not em-box. Baseline offset:
    // baseline_y = cy + (ascent - descent) / 2
    const baselineY = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(ATLAS_CHARS[i], cx, baselineY);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;  // No flip — shader row indexing matches canvas directly
  // Mipmaps must be OFF: the atlas packs adjacent glyph cells with no padding,
  // and mipmap generation averages ink across cell boundaries — producing
  // faint ghost outlines of neighbouring characters around every glyph.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// buildWordTexture
// ---------------------------------------------------------------------------
// Returns a 1×N DataTexture where each pixel stores the atlas index of one
// character from the easter-egg word list.  Words are packed sequentially in
// fixed-width slots of WORD_MAX_LEN, padded with 0 (space) for shorter words.
//
// The shader reads:
//   atlasIdx = texture2D(uWordTex, vec2((wordIdx*WORD_MAX_LEN + charOffset + 0.5) / texWidth, 0.5)).r * 255
// ---------------------------------------------------------------------------
export function buildWordTexture(): { texture: THREE.DataTexture; width: number } {
  const width = EASTER_EGG_WORDS.length * WORD_MAX_LEN;
  const data  = new Uint8Array(width);

  for (let w = 0; w < EASTER_EGG_WORDS.length; w++) {
    const word = EASTER_EGG_WORDS[w];
    for (let c = 0; c < WORD_MAX_LEN; c++) {
      const slot = w * WORD_MAX_LEN + c;
      if (c < word.length) {
        const ch = word[c];
        const letterOffset = ch.charCodeAt(0) - 65;  // 'A' = 0
        const atlasIdx     = WORD_OFFSET + letterOffset;
        data[slot] = atlasIdx >= 0 && atlasIdx < ATLAS_CHARS.length ? atlasIdx : 0;
      } else {
        data[slot] = 0;   // pad with space (atlas index 0)
      }
    }
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  texture.minFilter   = THREE.NearestFilter;
  texture.magFilter   = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return { texture, width };
}
