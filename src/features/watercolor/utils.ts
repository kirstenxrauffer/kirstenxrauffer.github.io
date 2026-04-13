import { HERO_IMAGES } from './constants';

/** Picks a random hero image path from the pool. */
export function pickHeroImage(): string {
  return HERO_IMAGES[Math.floor(Math.random() * HERO_IMAGES.length)];
}

/** Derives a stable [0, 1] float from a route slug for per-page bloom seeding. */
export function slugToSeed(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (Math.imul(31, h) + slug.charCodeAt(i)) >>> 0;
  }
  return (h % 65536) / 65536;
}

// ── Palette extraction ────────────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

/**
 * Extracts `count` perceptually-distinct dominant colours from a loaded image.
 * Returns CSS `rgb(r,g,b)` strings.
 *
 * Algorithm:
 *  1. Draws the image into a 32×32 offscreen canvas.
 *  2. Filters out near-black, near-white, and desaturated pixels.
 *  3. Uses greedy max-distance selection in hue space so the palette has
 *     well-spread, varied hues rather than several near-identical ones.
 */
export function extractPalette(
  img: HTMLImageElement | ImageBitmap,
  count = 4,
): string[] {
  const SIZE = 32;
  const canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  ctx.drawImage(img as CanvasImageSource, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

  type P = { h: number; s: number; l: number; r: number; g: number; b: number };
  let pixels: P[] = [];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const [h, s, l] = rgbToHsl(r, g, b);
    // Keep only reasonably colourful, mid-lightness pixels
    if (s < 0.10 || l < 0.12 || l > 0.90) continue;
    pixels.push({ h, s, l, r: data[i], g: data[i + 1], b: data[i + 2] });
  }

  // Fallback if the image is very desaturated — relax the saturation floor
  if (pixels.length < count) {
    pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (l < 0.08 || l > 0.92) continue;
      pixels.push({ h, s, l, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }

  if (pixels.length === 0) return [];

  // Sort most-saturated first so the greedy pass anchors on vivid colours
  pixels.sort((a, b) => b.s - a.s);

  // Greedy max-distance selection: each new pick maximises its min-distance
  // to already-selected pixels in hue space
  const selected: P[] = [pixels[0]];
  while (selected.length < count && selected.length < pixels.length) {
    let bestDist = -1;
    let best: P | null = null;
    for (const p of pixels) {
      const minDist = Math.min(...selected.map(s => hueDist(s.h, p.h)));
      if (minDist > bestDist) {
        bestDist = minDist;
        best     = p;
      }
    }
    if (!best) break;
    selected.push(best);
  }

  return selected.map(p => `rgb(${p.r},${p.g},${p.b})`);
}
