/**
 * Shared singleton: React (FairyCanvas) writes; the p5 FSM reads.
 * Keeps the sketch decoupled from React without prop-drilling into the sketch.
 */
export const navArea = {
  /** True while the nav menu is open. */
  active: false,
  /** World-space position where navi was when the nav was last opened. */
  clickX: 0,
  clickY: 0,
  /**
   * Set to true by FairyCanvas when the user clicks navi to OPEN the nav.
   * The FSM reads and clears this each tick to enter the navOrbit state.
   */
  zoomRequested: false,
  /**
   * Screen-space centres of the top-level nav buttons, captured by FairyCanvas
   * at the moment the nav opens. The FSM orbits each in turn.
   */
  navLinks: [] as { x: number; y: number }[],
};
