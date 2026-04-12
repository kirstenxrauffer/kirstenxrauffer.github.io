// Window-level pointer observer. Single mutable record shared across
// the entire fairies feature. Refcounted subscribe()/unsubscribe() so
// Vite HMR can't double-attach listeners if the module is re-evaluated
// without React re-running the mounting useEffect.

export type Pointer = {
  x: number;
  y: number;
  seen: boolean; // true once pointer position is known (set at subscribe time)
};

export const pointer: Pointer = { x: 0, y: 0, seen: false };

let subscribed = 0;
let onMouseMove: ((e: MouseEvent) => void) | null = null;
let onTouchStart: ((e: TouchEvent) => void) | null = null;
let onTouchMove: ((e: TouchEvent) => void) | null = null;

function updateFromTouch(e: TouchEvent): void {
  const t = e.touches[0];
  if (!t) return;
  pointer.x = t.clientX;
  pointer.y = t.clientY;
  pointer.seen = true;
}

export function subscribePointer(): () => void {
  subscribed += 1;
  if (subscribed > 1) {
    // Already wired; return a matching unsub so the refcount balances.
    return unsubscribePointer;
  }

  // Seed position to viewport center so Navi approaches immediately even if
  // the cursor never fires a mousemove (e.g. user hasn't moved yet).
  // The first real mousemove overwrites these with the true coordinates.
  pointer.x = window.innerWidth / 2;
  pointer.y = window.innerHeight / 2;
  pointer.seen = true;

  onMouseMove = (e: MouseEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.seen = true;
  };
  onTouchStart = updateFromTouch;
  onTouchMove = updateFromTouch;

  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });

  return unsubscribePointer;
}

export function unsubscribePointer(): void {
  subscribed = Math.max(0, subscribed - 1);
  if (subscribed > 0) return;
  if (onMouseMove) window.removeEventListener('mousemove', onMouseMove);
  if (onTouchStart) window.removeEventListener('touchstart', onTouchStart);
  if (onTouchMove) window.removeEventListener('touchmove', onTouchMove);
  onMouseMove = null;
  onTouchStart = null;
  onTouchMove = null;
}
