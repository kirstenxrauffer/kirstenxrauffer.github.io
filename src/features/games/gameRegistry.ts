import type { GameEntry } from './types';

// Add new games here. Each entry is lazy-imported on first play so the initial
// bundle doesn't balloon as the catalog grows.
export const GAME_REGISTRY: GameEntry[] = [
  {
    id: 'war',
    label: 'play war',
    component: () => import('./War/WarGame'),
    available: true,
  },
  {
    id: 'spit',
    label: 'play spit',
    component: () => import('./Spit/SpitGame'),
    available: true,
  },
  {
    id: 'rummy',
    label: 'play gin rummy',
    component: () => import('./Rummy/RummyGame'),
    available: true,
  },
];

export function findGame(id: string): GameEntry | undefined {
  return GAME_REGISTRY.find((g) => g.id === id);
}
