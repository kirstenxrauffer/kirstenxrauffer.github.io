export type PollenStamp = {
  x: number;
  y: number;
  createdAt: number; // p.millis() at spawn
  rngSeed: number;   // pinned so dot positions don't shimmer across frames
};
