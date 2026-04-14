/**
 * Shared singleton: React (FairyCanvas/App) writes; the p5 FSM reads (and
 * occasionally writes flags back). Keeps the sketch decoupled from React.
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
   * Screen-space bounding circle of the nav-menu container (centre + radius),
   * captured by FairyCanvas at the moment the nav opens. The FSM orbits this
   * ONCE then exits to gameApproach.
   */
  navContainer: null as { cx: number; cy: number; radius: number } | null,

  /**
   * FSM → React signal: set to true when navi completes her container orbit
   * and has arrived near the cursor. React reads this to show the game prompt
   * tooltip, then clears it.
   */
  gamePromptOpen: false,

  /**
   * React → FSM signal: set when the user starts or ends a game. The FSM
   * consumes these to transition mood/state.
   */
  gameStartRequested: false,
  gameResult: null as null | 'win' | 'lose',

  /**
   * React → FSM signal: user dismissed the game prompt without playing
   * (e.g. clicked elsewhere). Clears mood back to normal.
   */
  dismissRequested: false,
};
