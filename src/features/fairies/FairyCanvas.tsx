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

// Reads screen-space centres of the top-level nav buttons. Returns [] if the
// nav hasn't mounted yet — the FSM falls back to no-op when the list is empty.
function readNavLinkCenters(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  document.querySelectorAll('.nav-menu__btn').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });
  return out;
}

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
      // Only request orbit on the OPENING click; closing clicks shouldn't re-trigger.
      // Sync navArea.active synchronously so the next p5 frame doesn't see a stale
      // value before React commits the navOpen state via the useEffect below.
      if (!navArea.active) {
        navArea.navLinks = readNavLinkCenters();
        navArea.zoomRequested = true;
        navArea.active = true;
      }
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
      // Sequential import — NOT Promise.all. ./sketch statically imports
      // p5.brush, which evaluates module-load-time code that registers its
      // p5 lifecycle hooks via `if (typeof p5 !== "undefined") p5.registerAddon(...)`.
      // p5 v2 ESM does NOT publish itself to window, so we publish it here
      // before p5.brush ever evaluates. Without this, the hooks never register
      // and brush operations on a non-active p5 instance silently misroute
      // (see StickyDivider for the same fix and longer note).
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
            // Cancel any pending hide — keep visible while hovering.
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          } else {
            scheduleHide(1500);
          }
        },
        // Update label position every frame by mutating the DOM directly —
        // avoids 60 fps React re-renders.
        onPositionChange: (x, y) => {
          const el = labelRef.current;
          if (!el) return;
          el.style.transform =
            `translate(calc(${x}px - 50%), calc(${y - LABEL_OFFSET_Y}px - 100%))`;

          // Hide label when it's near other page content.
          const rect = el.getBoundingClientRect();
          if (rect.width === 0) return; // not yet painted

          // The fairy-canvas container wraps both the host and the label —
          // use it as the exclusion root so we only flag external content.
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
