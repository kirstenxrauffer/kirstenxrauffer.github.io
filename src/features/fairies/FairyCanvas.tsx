import { useEffect, useRef } from 'react';
import type p5Type from 'p5';
import styles from './FairyCanvas.module.scss';
import { subscribePointer } from './input/pointer';
import { mountCursorDot } from './pollen';

type Props = {
  onFairyClick?: () => void;
};

export default function FairyCanvas({ onFairyClick }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Tracks hover state so the window click listener can gate on it without
  // needing pointer-events on the canvas (which would block UI clicks).
  const isHoveringRef = useRef(false);

  // Window-level click listener — fires regardless of pointer-events: none
  // on the canvas. Calls onFairyClick only when the pointer is over a fairy.
  useEffect(() => {
    if (!onFairyClick) return;
    const handleClick = () => { if (isHoveringRef.current) onFairyClick(); };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [onFairyClick]);

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
  }, []);

  return (
    <div
      ref={hostRef}
      className={`${styles['fairy-canvas']} ${styles['fairy-canvas__host']}`}
      aria-hidden="true"
    />
  );
}
