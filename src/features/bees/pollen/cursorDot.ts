// Mounts/unmounts alongside the p5 BeeCanvas instance.
// The pollen trail is the visual cursor effect; the OS cursor remains visible.
// Returns a no-op disposer for symmetry with BeeCanvas mount/unmount lifecycle.

export function mountCursorDot(): () => void {
  return () => {};
}
