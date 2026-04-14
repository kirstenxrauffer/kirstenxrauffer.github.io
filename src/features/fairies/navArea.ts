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

  /**
   * React → FSM signal: while true, navi holds still at her current position
   * and emits pollen (the prompt-backdrop is dimming the screen). Cleared on
   * dismiss / game start so she returns to wander.
   */
  holdForPrompt: false,

  /**
   * React → FSM signal: live screen-space position of the "you" label on the
   * card-game board. While set, navi enters gameHover and lightly orbits this
   * point so she stays visible beside the player's name without obstructing
   * the board. Null when no game is active.
   */
  gameAnchor: null as { x: number; y: number } | null,

  /**
   * React → sketch signal: mood to apply to all live fairies on the next tick.
   * Sketch copies this onto fairy.mood each frame so existing fairies pick up
   * changes without restarting.
   */
  currentMood: 'normal' as 'normal' | 'angry' | 'celebrate',
};
