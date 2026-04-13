import { useCallback, useEffect, useRef } from 'react';
import type p5Type from 'p5';
import styles from './FairyCanvas.module.scss';
import { subscribePointer } from './input/pointer';
import { mountCursorDot } from './pollen';
import { navArea } from './navArea';

type Props = {
  onFairyClick?: () => void;
  navOpen?: boolean;
};

// How far above fairy.pos.y (the body centre) the bottom of the label sits.
// Wings extend ~27 px above centre at current scale; 50 px gives a clear gap.
const LABEL_OFFSET_Y = 50;

export default function FairyCanvas({ onFairyClick, navOpen }: Props) {
  const hostRef       = useRef<HTMLDivElement>(null);
  const labelRef      = useRef<HTMLDivElement>(null);
  const isHoveringRef = useRef(false);
  const hideTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror navOpen into the navArea singleton so the FSM can read it each frame.
  useEffect(() => {
    navArea.active = navOpen ?? false;
  }, [navOpen]);

  // Shows the label immediately; caller is responsible for scheduling a hide.
  const showLabel = useCallback(() => {
    if (labelRef.current) labelRef.current.dataset.visible = 'true';
  }, []);

  // Hides the label after `delay` ms, skipped if pointer is still hovering.
  const scheduleHide = useCallback((delay: number) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (labelRef.current && !isHoveringRef.current) {
        labelRef.current.dataset.visible = 'false';
      }
    }, delay);
  }, []);

  // Initial show (1 s after mount so position is known) + periodic nudge.
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

  // Window-level click listener — fires regardless of pointer-events: none
  // on the canvas. Calls onFairyClick only when the pointer is over a fairy.
  useEffect(() => {
    if (!onFairyClick) return;
    const handleClick = (e: MouseEvent) => {
      if (!isHoveringRef.current) return;
      // Don't fire when the user clicked on interactive UI (nav buttons, links, etc.)
      if ((e.target as Element).closest('button, a, [role="button"], input, select')) return;
      // Record position so the FSM knows where to compute the flee target from.
      navArea.clickX = e.clientX;
      navArea.clickY = e.clientY;
      onFairyClick();
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [onFairyClick]);

  // p5 sketch — async import keeps the heavy canvas code out of the initial bundle.
  useEffect(() => {
    let instance: p5Type | null = null;
    let cancelled = false;
    const unsubInput = subscribePointer();
    const unmountDot = mountCursorDot();

    (async () => {
      const [{ default: P5 }, { makeSketch }] = await Promise.all([
        import('p5'),
        import('./sketch'),
      ]);
      if (cancelled || !hostRef.current) return;
      instance = new P5(makeSketch({
        onHoverChange: (h) => {
          isHoveringRef.current = h;
          document.body.style.cursor = h ? 'pointer' : '';
          if (h) {
            showLabel();
            // Cancel any pending hide — keep visible while hovering.
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          } else {
            scheduleHide(1500);
          }
        },
        // Update label position every frame by mutating the DOM directly —
        // avoids 60 fps React re-renders.
        onPositionChange: (x, y) => {
          if (labelRef.current) {
            labelRef.current.style.transform =
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

  return (
    <div className={styles['fairy-canvas']} aria-hidden="true">
      <div ref={hostRef} className={styles['fairy-canvas__host']} />
      <div ref={labelRef} className={styles['fairy-label']}>
        <span className={styles['fairy-label__text']}>whatcha looking for?</span>
        <div className={styles['fairy-label__arrow']} />
      </div>
    </div>
  );
}
