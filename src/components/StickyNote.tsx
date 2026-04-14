import { useState, useCallback, useRef, useEffect } from 'react';
import styles from './StickyNote.module.scss';
import { StickyDivider } from './StickyDivider';
import type { StickyNotePalette } from '../constants/stickyNoteColors';

interface StickyNoteProps {
  title?: string;
  palette: StickyNotePalette;
  rotation: number;
  children: React.ReactNode;
}

// Note inner width: 175px outer − 2 × 0.8rem padding ≈ 149px.
// Divider sits at 145px to leave a hair of breathing room on each side.
const DIVIDER_W = 145;
const DIVIDER_H = 12;

const HOVER_DELAY_MS = 250;
// Movement past this many CSS pixels during a press counts as a drag,
// not a tap — so the touch-tap grow effect won't fire.
const DRAG_THRESHOLD_PX = 6;

export function StickyNote({ title, palette, rotation, children }: StickyNoteProps) {
  const [pos, setPos]         = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [hoverReady, setHoverReady] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const downPos = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const pointerTypeRef = useRef<string>('mouse');
  const tapHeldRef = useRef(false);
  const hoverTimer = useRef<number | null>(null);
  const noteRef = useRef<HTMLDivElement>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  // When the grow effect was activated by a tap (touch), dismiss it on the
  // next pointerdown anywhere outside this note.
  useEffect(() => {
    if (!hoverReady || !tapHeldRef.current) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (noteRef.current && !noteRef.current.contains(e.target as Node)) {
        tapHeldRef.current = false;
        setHoverReady(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [hoverReady]);

  const onPointerEnter = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Dwell-to-grow is a mouse/pen interaction; touch uses tap-end instead.
    if (e.pointerType === 'touch') return;
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      setHoverReady(true);
      hoverTimer.current = null;
    }, HOVER_DELAY_MS);
  }, [clearHoverTimer]);

  const onPointerLeave = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    clearHoverTimer();
    setHoverReady(false);
  }, [clearHoverTimer]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    clearHoverTimer();
    // For touch, don't reset hoverReady here — onPointerUp toggles it, and
    // resetting first would cause !false=true on up, preventing shrink.
    if (e.pointerType !== 'touch') {
      setHoverReady(false);
    }
    tapHeldRef.current = false;
    setIsDragging(true);
    pointerTypeRef.current = e.pointerType;
    draggedRef.current = false;
    downPos.current = { x: e.clientX, y: e.clientY };
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [clearHoverTimer]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    if (!draggedRef.current) {
      const tdx = e.clientX - downPos.current.x;
      const tdy = e.clientY - downPos.current.y;
      if (tdx * tdx + tdy * tdy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        draggedRef.current = true;
      }
    }
    setPos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (pointerTypeRef.current === 'touch' && !draggedRef.current) {
      // Tap (no drag) on touch → toggle the grow effect on tap end.
      setHoverReady(prev => {
        const next = !prev;
        tapHeldRef.current = next;
        return next;
      });
    }
  }, []);

  const className = [
    styles.note,
    isDragging && styles.dragging,
    hoverReady && !isDragging && styles.hoverReady,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={noteRef}
      className={className}
      style={{
        backgroundColor: palette.bg,
        color: palette.text,
        '--snx': `${pos.x}px`,
        '--sny': `${pos.y}px`,
        '--snr': `${rotation}deg`,
      } as React.CSSProperties}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {title && (
        <>
          <h2 className={styles.title}>{title}</h2>
          <StickyDivider width={DIVIDER_W} height={DIVIDER_H} color={palette.divider} />
        </>
      )}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
