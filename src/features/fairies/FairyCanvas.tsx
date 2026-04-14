import { useCallback, useEffect, useRef, useState } from 'react';
import type p5Type from 'p5';
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
  /** Hide the prompt tooltip when a game is active so it doesn't overlap the modal. */
  gameActive?: boolean;
};

const LABEL_OFFSET_Y = 50;

export default function FairyCanvas({ onFairyClick, navOpen, onGameStart, gameActive }: Props) {
  const hostRef       = useRef<HTMLDivElement>(null);
  const labelRef      = useRef<HTMLDivElement>(null);
  const promptRef     = useRef<HTMLDivElement>(null);
  const isHoveringRef = useRef(false);
  const hideTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const tick = () => {
      const el = document.querySelector<HTMLElement>('[data-navi-anchor="you"]');
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          navArea.gameAnchor = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        } else {
          navArea.gameAnchor = null;
        }
      } else {
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
    const handleClick = (e: MouseEvent) => {
      if (!isHoveringRef.current) return;
      if ((e.target as Element).closest('button, a, [role="button"], input, select')) return;
      navArea.clickX = e.clientX;
      navArea.clickY = e.clientY;
      // Simple ritual: dim the screen (via the prompt backdrop), freeze navi
      // in place with pollen, and show the prompt immediately. No nav-orbit
      // travel, no nav-menu opening.
      navArea.holdForPrompt = true;
      // Close the nav if it happens to be open so the dim layer is clean.
      if (navOpen) onFairyClick?.();
      setPromptOpen(true);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [onFairyClick, navOpen]);

  useEffect(() => {
    let instance: p5Type | null = null;
    let cancelled = false;
    const unsubInput = subscribePointer();
    const unmountDot = mountCursorDot();

    (async () => {
      const { default: P5 } = await import('p5');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).p5 = P5;
      const { makeSketch } = await import('./sketch');
      if (cancelled || !hostRef.current) return;
      instance = new P5(makeSketch({
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
          const el = labelRef.current;
          const promptEl = promptRef.current;
          if (el) {
            el.style.transform =
              `translate(calc(${x}px - 50%), calc(${y - LABEL_OFFSET_Y}px - 100%))`;

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
          // Position the game-prompt tooltip above navi in the same way.
          if (promptEl) {
            promptEl.style.transform =
              `translate(calc(${x}px - 50%), calc(${y - LABEL_OFFSET_Y}px - 100%))`;
          }
        },
      }), hostRef.current);
    })();

    return () => {
      cancelled = true;
      instance?.remove();
      instance = null;
      unmountDot();
      unsubInput();
      document.body.style.cursor = '';
    };
  }, [showLabel, scheduleHide]);

  const handleDismiss = useCallback(() => {
    setPromptOpen(false);
    navArea.holdForPrompt = false;
    navArea.dismissRequested = true;
  }, []);

  const handlePickGame = useCallback((gameId: string) => {
    setPromptOpen(false);
    navArea.holdForPrompt = false;
    navArea.gameStartRequested = true;
    onGameStart?.(gameId);
  }, [onGameStart]);

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
          <div className={styles['fairy-prompt__text']}>want to play a game?</div>
          <div className={styles['fairy-prompt__buttons']}>
            {GAME_REGISTRY.map((g) => (
              <button
                key={g.id}
                type="button"
                className={styles['fairy-prompt__btn']}
                onClick={() => handlePickGame(g.id)}
                disabled={!g.available}
              >
                {g.label}
              </button>
            ))}
            <button
              type="button"
              className={styles['fairy-prompt__btn--ghost']}
              onClick={handleDismiss}
            >
              no thanks
            </button>
          </div>
        </div>
        <div className={styles['fairy-prompt__arrow']} />
      </div>
    </div>
  );
}
