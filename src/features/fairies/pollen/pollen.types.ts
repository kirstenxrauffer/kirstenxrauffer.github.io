export type PollenStamp = {
  x: number;
  y: number;
  createdAt: number;   // p.millis() at spawn
  rngSeed: number;     // pinned so dot positions don't shimmer across frames
  sparklePhase: number; // random phase (0–2π) so stamps twinkle at different times
};
