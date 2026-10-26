// Shared snap logic for the playlist and piano roll. Sizes are in steps (1/16 notes).
export const SNAPS = [
  { id: 'line', label: 'Line' },
  { id: 'none', label: 'None' },
  { id: 'quarter-step', label: '1/4 step', size: 0.25 },
  { id: 'half-step', label: '1/2 step', size: 0.5 },
  { id: 'step', label: 'Step', size: 1 },
  { id: 'half-beat', label: '1/2 beat', size: 2 },
  { id: 'beat', label: 'Beat', size: 4 },
  { id: 'bar', label: 'Bar', size: 16 },
];

/** Resolve the effective snap size in steps for the given zoom (pixels per step). 0 = no snapping. */
export function snapSize(id, pxPerStep) {
  if (id === 'none') return 0;
  const fixed = SNAPS.find((s) => s.id === id)?.size;
  if (fixed) return fixed;
  // "Line": snap to the finest grid line that is visible at this zoom level
  for (const size of [0.25, 0.5, 1, 2, 4, 16]) if (size * pxPerStep >= 10) return size;
  return 16;
}

export const snapRound = (v, size) => (size ? Math.round(v / size) * size : v);
export const snapFloor = (v, size) => (size ? Math.floor(v / size + 1e-9) * size : v);
