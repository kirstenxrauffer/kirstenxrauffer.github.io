/** Classic sticky-note palette. Each entry includes:
 *   bg      — the note background
 *   text    — an accessible, darker shade of bg used for type
 *   divider — a contrasting hue to text used for the squiggle divider
 * Randomized on each carousel open. */
export interface StickyNotePalette {
  bg: string;
  text: string;
  divider: string;
}

export const STICKY_NOTE_PALETTES: StickyNotePalette[] = [
  { bg: '#fff176', text: '#5a4500', divider: '#5b2a8c' }, // yellow → violet
  { bg: '#ffcc80', text: '#5a3000', divider: '#0d6e8c' }, // orange → teal
  { bg: '#f8a4b8', text: '#7a1f3a', divider: '#1a6e3d' }, // pink → forest
  { bg: '#90caf9', text: '#0e3c66', divider: '#c75a14' }, // blue → burnt orange
];
