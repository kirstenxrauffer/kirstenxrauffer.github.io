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
};
