export interface WatercolorCanvasProps {
  /** Route slug — drives uBloomSeed so each page gets a unique bloom shape. */
  slug?: string;
  /** Normalised [0, 1] bloom origin. Defaults to viewport centre. */
  bloomOrigin?: [number, number];
  /** Hero image path. When provided, overrides the internal random pick. */
  image?: string;
}
