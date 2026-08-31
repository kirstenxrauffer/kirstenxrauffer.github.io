export interface AsciiCanvasProps {
  /** Path to the source photograph.  Falls back to a random hero image. */
  image?: string;
  /** Character cell width in screen pixels. Smaller = more detail. */
  cellSize?: number;
  /** Detail tolerance 0..1. Higher values suppress mid-tone noise. */
  tolerance?: number;
  /** Scramble animation duration in seconds. */
  scrambleDuration?: number;
  /**
   * Overlay mode: drops the paper background to transparent so the ASCII
   * effect composites over whatever canvas sits behind it (e.g. the
   * watercolor). Also hides the debug panel and disables pointer events.
   */
  overlay?: boolean;
}
