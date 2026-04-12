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
