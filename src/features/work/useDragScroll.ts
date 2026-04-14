import { useEffect, type RefObject } from 'react';

const DRAG_THRESHOLD_PX = 5;

export function useDragScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startScrollLeft = 0;
    let dragged = false;
    let suppressClickUntil = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Touch already gets native horizontal scroll via overflow-x:auto —
      // intercepting it would fight the browser's panning gesture.
      if (e.pointerType === 'touch') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startScrollLeft = el.scrollLeft;
      dragged = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) >= DRAG_THRESHOLD_PX) {
        dragged = true;
        el.classList.add('wc-row__track--dragging');
        // Capture so we keep getting moves even if pointer leaves the track
        try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
      }
      if (dragged) {
        el.scrollLeft = startScrollLeft - dx;
        e.preventDefault();
      }
    };

    const finish = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      if (dragged) {
        suppressClickUntil = performance.now() + 300;
        el.classList.remove('wc-row__track--dragging');
        try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      }
      pointerId = null;
      dragged = false;
    };

    // Capture-phase click: swallow the click that fires after a drag-release
    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
        suppressClickUntil = 0;
      }
    };

    // Block native image drag inside the track (would hijack the gesture)
    const onDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('dragstart', onDragStart);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('dragstart', onDragStart);
    };
  }, [ref]);
}
