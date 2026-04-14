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

// Movement past this many CSS pixels during a press counts as a drag,
// not a tap — so the tap-to-grow effect won't fire.
const DRAG_THRESHOLD_PX = 6;

export function StickyNote({ title, palette, rotation, children }: StickyNoteProps) {
  const [pos, setPos]         = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [grown, setGrown] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const downPos = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const noteRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState<number>(0.58);

  // Shrink content font-size until it fits the fixed-height note (no overflow).
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let size = 0.58;
    const min = 0.36;
    const step = 0.02;
    el.style.fontSize = `${size}rem`;
    while (el.scrollHeight > el.clientHeight && size > min) {
      size -= step;
      el.style.fontSize = `${size}rem`;
    }
    setFontSize(size);
  }, [children]);

  // Dismiss grown state on pointerdown anywhere outside this note.
  useEffect(() => {
    if (!grown) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (noteRef.current && !noteRef.current.contains(e.target as Node)) {
        setGrown(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [grown]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggedRef.current = false;
    downPos.current = { x: e.clientX, y: e.clientY };
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    // Hold off on visual drag state (and position updates) until movement
    // crosses the threshold. That way a press or tap — or the start of a
    // click — doesn't shrink a hover-expanded note before the user has
    // actually committed to dragging.
    if (!draggedRef.current) {
      const tdx = e.clientX - downPos.current.x;
      const tdy = e.clientY - downPos.current.y;
      if (tdx * tdx + tdy * tdy <= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      draggedRef.current = true;
      setIsDragging(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!draggedRef.current) {
      setGrown(prev => !prev);
    }
  }, []);

  const className = [
    styles.note,
    isDragging && styles.dragging,
    grown && !isDragging && styles.hoverReady,
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
      <div
        ref={contentRef}
        className={styles.content}
        style={{ '--sn-font-size': `${fontSize}rem` } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}
