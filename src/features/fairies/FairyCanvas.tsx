import { useCallback, useEffect, useRef, useState } from 'react';
import type { FairySketch } from './sketch';
import styles from './FairyCanvas.module.scss';
import { subscribePointer } from './input/pointer';
import { mountCursorDot } from './pollen';
import { navArea } from './navArea';
import { GAME_REGISTRY } from '../games/gameRegistry';

type Props = {
  onFairyClick?: () => void;
  navOpen?: boolean;
  /** Called when user clicks a game in the prompt tooltip. */
  onGameStart?: (gameId: string) => void;
  /** Called when the user picks "quit game" from the in-game prompt. */
  onGameQuit?: () => void;
  /**
   * Id of the game currently being played, or null. Drives the prompt's
   * in-game variant (switch game / quit) and lifts navi above the board.
   */
  activeGameId?: string | null;
};

const LABEL_OFFSET_Y = 50;
/**
 * How long a missing `[data-navi-anchor]` is tolerated before navi is released
 * from her hover orbit. Covers the frame gap while one game unmounts and the
 * next mounts during a mid-game switch, so she doesn't dart off and fly back.
 */
const ANCHOR_GRACE_MS = 400;
/**
 * Radius around navi's centre that counts as a click ON her, as opposed to
 * merely near her. Her glow halo reaches GLOW_MAX_R (BODY.r 38 × 4.95 ≈ 188
 * local units) × FAIRY_SCALE 0.25 ≈ 47 px, with the body and wings inside
 * ~30 px, so 42 px covers the whole visible sprite without spilling far into
 * the board. Deliberately tighter than the sketch's 80 px hover radius, which
 * only drives affordances (cursor, label) and is far too loose to arbitrate
 * clicks against the cards underneath.
 */
const NAVI_HIT_RADIUS = 42;

export default function FairyCanvas({
  onFairyClick,
  navOpen,
  onGameStart,
  onGameQuit,
  activeGameId = null,
}: Props) {
  const gameActive = activeGameId !== null;
  const hostRef       = useRef<HTMLDivElement>(null);
  const labelRef      = useRef<HTMLDivElement>(null);
  const promptRef     = useRef<HTMLDivElement>(null);
  const isHoveringRef = useRef(false);
  const hideTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Throttle state for the label's near-content hit test (see onPositionChange).
  const nearTestAtRef  = useRef(0);
  const labelWasVisible = useRef(false);
  // Navi's live screen position, mirrored from the sketch each frame so the
  // click handler can hit-test against her sprite. Null until the sketch chunk
  // loads and reports a first frame — without that, an unresolved (0,0) would
  // make clicks in the top-left corner read as hits on her.
  const naviPosRef = useRef<{ x: number; y: number } | null>(null);
  // Game prompt visibility: set when the FSM finishes the container orbit.
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    navArea.active = navOpen ?? false;
  }, [navOpen]);

  const showLabel = useCallback(() => {
    if (labelRef.current) labelRef.current.dataset.visible = 'true';
  }, []);

  const scheduleHide = useCallback((delay: number) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (labelRef.current && !isHoveringRef.current) {
        labelRef.current.dataset.visible = 'false';
      }
    }, delay);
  }, []);

  useEffect(() => {
    const initialTimer = setTimeout(() => {
      showLabel();
      scheduleHide(3000);
    }, 1000);
    const repeatInterval = setInterval(() => {
      if (!isHoveringRef.current) {
        showLabel();
        scheduleHide(2000);
      }
    }, 10_000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(repeatInterval);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showLabel, scheduleHide]);

  // Poll the navArea singleton for the FSM → React signal. The FSM sets
  // gamePromptOpen once it finishes the container orbit; we pick it up and
  // show the prompt + close the nav menu.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (navArea.gamePromptOpen) {
        navArea.gamePromptOpen = false;
        navArea.active = false; // release nav-menu from "fleeing" logic
        setPromptOpen(true);
        if (navOpen) onFairyClick?.(); // close nav menu
      }
    }, 60);
    return () => clearInterval(id);
  }, [navOpen, onFairyClick]);

  // Hide the prompt when a game becomes active (modal takes over).
  useEffect(() => {
    if (gameActive) setPromptOpen(false);
  }, [gameActive]);

  // Stream the "you" label's screen-space position into navArea while a game
  // is active so the FSM can lightly orbit it. rAF keeps the anchor in sync
  // with scroll / resize / layout shifts during play. Cleared on unmount.
  useEffect(() => {
    if (!gameActive) {
      navArea.gameAnchor = null;
      return;
    }
    let raf = 0;
    let lastSeenAt = performance.now();
    const tick = () => {
      // Games tag one element — typically navi's own side-of-board label —
      // with `data-navi-anchor`; the attribute's value is a semantic hint
      // ("navi", "you", etc.) and not used for matching. Any game that wants
      // navi to hover somewhere else just puts the attribute wherever it
      // prefers.
      const el = document.querySelector<HTMLElement>('[data-navi-anchor]');
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        lastSeenAt = performance.now();
        navArea.gameAnchor = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      } else if (performance.now() - lastSeenAt > ANCHOR_GRACE_MS) {
        // Only give up on the anchor once it's been gone a while — switching
        // games unmounts one board before the next mounts, and dropping the
        // anchor for those few frames would kick navi out of gameHover.
        navArea.gameAnchor = null;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      navArea.gameAnchor = null;
    };
  }, [gameActive]);

  useEffect(() => {
    let instance: FairySketch | null = null;
    let cancelled = false;
    const unsubInput = subscribePointer();
    const unmountDot = mountCursorDot();

    (async () => {
      // Still dynamically imported so the fairy layer stays off the critical
      // path, but the chunk is now a few KB of our own code rather than p5.
      const { createFairySketch } = await import('./sketch');
      if (cancelled || !hostRef.current) return;
      instance = createFairySketch(hostRef.current, {
        onHoverChange: (h) => {
          isHoveringRef.current = h;
          document.body.style.cursor = h ? 'pointer' : '';
          if (h) {
            showLabel();
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          } else {
            scheduleHide(1500);
          }
        },
        onPositionChange: (x, y) => {
          naviPosRef.current = { x, y };
          const el = labelRef.current;
          const promptEl = promptRef.current;
          if (el) {
            el.style.transform =
              `translate(calc(${x}px - 50%), calc(${y - LABEL_OFFSET_Y}px - 100%))`;

            // The near-content hit test drives `data-near-content`, which the
            // stylesheet only reads under `[data-visible='true']` — so it is
            // pure waste while the label is hidden (most of the time). It is
            // also the most expensive thing in this callback: getBoundingClientRect
            // plus up to 7 document.elementsFromPoint calls, each forcing a
            // style/layout flush and a full hit test. Running it every draw
            // frame meant up to ~420 forced layouts per second.
            //
            // Gate on visibility, and throttle to 120 ms while visible — well
            // inside the 0.35 s opacity transition, so the fade still lands on
            // the correct state. Recompute immediately on the hidden→visible
            // edge so the label never fades in with a stale value.
            const visible = el.dataset.visible === 'true';
            const justShown = visible && !labelWasVisible.current;
            labelWasVisible.current = visible;

            const nowMs = performance.now();
            if (visible && (justShown || nowMs - nearTestAtRef.current >= 120)) {
              nearTestAtRef.current = nowMs;
              const rect = el.getBoundingClientRect();
              if (rect.width > 0) {
                const fairyRoot = hostRef.current?.parentElement ?? null;
                const PAD = 20;
                const pts: [number, number][] = [
                  [rect.left  - PAD, rect.top    - PAD],
                  [rect.right + PAD, rect.top    - PAD],
                  [rect.left  - PAD, rect.bottom + PAD],
                  [rect.right + PAD, rect.bottom + PAD],
                  [rect.left + rect.width / 2, rect.top - PAD],
                  [rect.left  - PAD, rect.top + rect.height / 2],
                  [rect.right + PAD, rect.top + rect.height / 2],
                ];
                const nearContent = pts.some(([px, py]) =>
                  document.elementsFromPoint(px, py).some(e =>
                    e !== document.documentElement &&
                    e !== document.body &&
                    !(fairyRoot ? fairyRoot.contains(e) || e === fairyRoot : false)
                  )
                );
                el.dataset.nearContent = nearContent ? 'true' : 'false';
              }
            }
          }
          // Position the game-prompt tooltip relative to navi. If navi is too
          // close to the top of the screen, show below; otherwise show above.
          if (promptEl) {
            const promptH = promptEl.offsetHeight || 220;
            const spaceAbove = y - LABEL_OFFSET_Y - promptH;
            const below = spaceAbove < 16;
            promptEl.dataset.below = below ? 'true' : 'false';
            if (below) {
              promptEl.style.transform =
                `translate(calc(${x}px - 50%), ${y + LABEL_OFFSET_Y}px)`;
            } else {
              promptEl.style.transform =
                `translate(calc(${x}px - 50%), calc(${y - LABEL_OFFSET_Y}px - 100%))`;
            }
          }
        },
      });
    })();

    return () => {
      cancelled = true;
      instance?.destroy();
      instance = null;
      unmountDot();
      unsubInput();
      document.body.style.cursor = '';
    };
  }, [showLabel, scheduleHide]);

  // Closing the prompt has to clear the FSM's gamePromptOpen flag too: the FSM
  // raises it on the transition into gameIdle and the 60 ms poller above would
  // otherwise re-open the prompt for a click that lands inside that window.
  const closePrompt = useCallback(() => {
    setPromptOpen(false);
    navArea.gamePromptOpen = false;
  }, []);

  const handleDismiss = useCallback(() => {
    closePrompt();
    // Releasing holdForPrompt is enough on its own mid-game: the FSM sees the
    // still-live gameAnchor on the next tick and drops navi back into her
    // hover orbit rather than wandering off.
    navArea.holdForPrompt = false;
    navArea.dismissRequested = true;
  }, [closePrompt]);

  const handlePickGame = useCallback((gameId: string) => {
    closePrompt();
    navArea.holdForPrompt = false;
    navArea.gameStartRequested = true;
    onGameStart?.(gameId);
  }, [closePrompt, onGameStart]);

  const handleQuitGame = useCallback(() => {
    closePrompt();
    navArea.holdForPrompt = false;
    navArea.dismissRequested = true;
    onGameQuit?.();
  }, [closePrompt, onGameQuit]);

  // Click-to-summon. Registered in the CAPTURE phase on window, which matters
  // during a game: every game panel roots itself with `onClick={e =>
  // e.stopPropagation()}` (WarGame.tsx, SpitGame.tsx, RummyGame.tsx). React 18
  // delegates from the #root container, so that synthetic stopPropagation also
  // stops the NATIVE event at #root — a bubble-phase window listener never
  // fires while a board is mounted. Capture runs before #root either way.
  useEffect(() => {
    // A "direct hit" is a click landing on navi's sprite rather than merely
    // somewhere within her generous hover radius.
    const isDirectHit = (e: { clientX: number; clientY: number }) => {
      const navi = naviPosRef.current;
      if (!navi) return false;
      return Math.hypot(e.clientX - navi.x, e.clientY - navi.y) <= NAVI_HIT_RADIUS;
    };

    // Games bind card drags to pointerdown, so swallowing only the click would
    // still let a drag start underneath navi. Stop propagation (but never
    // preventDefault — that could suppress the follow-up click) so the board
    // never sees the press that was meant for her.
    const handlePointerDown = (e: PointerEvent) => {
      if (gameActive && isDirectHit(e)) e.stopPropagation();
    };

    const handleClick = (e: MouseEvent) => {
      const direct = isDirectHit(e);
      if (gameActive) {
        // Mid-game only a direct hit counts. The looser "anywhere while
        // hovering" rule below would fire on ordinary board clicks that happen
        // to land inside navi's 80 px hover radius.
        if (!direct) return;
        // She's drawn above the board, so a click on her belongs to her — take
        // it away from whatever card sits underneath.
        e.stopPropagation();
        e.preventDefault();
        if (promptOpen) { handleDismiss(); return; }
      } else {
        if (!isHoveringRef.current) return;
        if (
          !direct
          && (e.target as Element).closest('button, a, [role="button"], input, select')
        ) return;
      }
      navArea.clickX = e.clientX;
      navArea.clickY = e.clientY;
      // Simple ritual: dim the screen (via the prompt backdrop), freeze navi
      // in place with pollen, and show the prompt immediately. No nav-orbit
      // travel, no nav-menu opening. Mid-game the same gesture opens the
      // prompt's in-game variant (switch game / quit) — navi leaves her hover
      // orbit and holds still over the board while it's up.
      navArea.holdForPrompt = true;
      // Close the nav if it happens to be open so the dim layer is clean.
      if (navOpen) onFairyClick?.();
      setPromptOpen(true);
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('click', handleClick, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      window.removeEventListener('click', handleClick, { capture: true });
    };
  }, [onFairyClick, navOpen, gameActive, promptOpen, handleDismiss]);

  return (
    <div
      className={styles['fairy-canvas']}
      aria-hidden="true"
      data-game-active={gameActive ? 'true' : 'false'}
    >
      <div ref={hostRef} className={styles['fairy-canvas__host']} />
      <div
        className={styles['fairy-prompt-backdrop']}
        data-visible={promptOpen ? 'true' : 'false'}
        onClick={handleDismiss}
      />
      <div ref={labelRef} className={styles['fairy-label']} data-visible="false">
        <span className={styles['fairy-label__text']}>whatcha looking for?</span>
        <div className={styles['fairy-label__arrow']} />
      </div>
      <div
        ref={promptRef}
        className={styles['fairy-prompt']}
        data-visible={promptOpen ? 'true' : 'false'}
      >
        <div className={styles['fairy-prompt__bubble']}>
          <div className={styles['fairy-prompt__text']}>
            {gameActive ? 'wanna switch it up?' : 'want to play a game?'}
          </div>
          <div className={styles['fairy-prompt__buttons']}>
            {GAME_REGISTRY.map((g) => {
              const isCurrent = g.id === activeGameId;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={styles['fairy-prompt__btn']}
                  onClick={() => handlePickGame(g.id)}
                  disabled={!g.available || isCurrent}
                >
                  {isCurrent ? `${g.label} (playing)` : g.label}
                </button>
              );
            })}
            {gameActive && (
              <button
                type="button"
                className={styles['fairy-prompt__btn--quit']}
                onClick={handleQuitGame}
              >
                quit game
              </button>
            )}
            <button
              type="button"
              className={styles['fairy-prompt__btn--ghost']}
              onClick={handleDismiss}
            >
              {gameActive ? 'keep playing' : 'no thanks'}
            </button>
          </div>
        </div>
        <div className={styles['fairy-prompt__arrow']} />
      </div>
    </div>
  );
}
