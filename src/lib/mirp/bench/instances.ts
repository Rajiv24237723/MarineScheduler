/** Small, hand-built MIRPLib-style core instances for the P1 benchmark demo. */

import { CoreInstance } from './core';

const CHARTER = 100_000; // ₹ / vessel-day (objective unit)

/** A · 1 supply, 2 demands, 2 vessels — comfortably feasible. */
export const instanceA: CoreInstance = {
  name: 'core-A (1S·2D·2V)',
  horizon: 30,
  charterPerDay: CHARTER,
  ports: [
    { id: 'S0', kind: 'S', rate: 4000, init: 60000, smin: 5000, smax: 300000 },
    { id: 'D1', kind: 'D', rate: 1500, init: 20000, smin: 3000, smax: 60000 },
    { id: 'D2', kind: 'D', rate: 1200, init: 18000, smin: 3000, smax: 55000 },
  ],
  vessels: [{ id: 'v1', cap: 30000 }, { id: 'v2', cap: 30000 }],
  travel: [
    [0, 3, 5],
    [3, 0, 4],
    [5, 4, 0],
  ],
};

/** B · 2 supplies, 3 demands, 3 vessels. */
export const instanceB: CoreInstance = {
  name: 'core-B (2S·3D·3V)',
  horizon: 30,
  charterPerDay: CHARTER,
  ports: [
    { id: 'S0', kind: 'S', rate: 5000, init: 80000, smin: 5000, smax: 400000 },
    { id: 'S1', kind: 'S', rate: 3000, init: 50000, smin: 5000, smax: 300000 },
    { id: 'D1', kind: 'D', rate: 1600, init: 22000, smin: 3000, smax: 70000 },
    { id: 'D2', kind: 'D', rate: 1300, init: 18000, smin: 3000, smax: 60000 },
    { id: 'D3', kind: 'D', rate: 1100, init: 16000, smin: 3000, smax: 55000 },
  ],
  vessels: [{ id: 'v1', cap: 28000 }, { id: 'v2', cap: 28000 }, { id: 'v3', cap: 22000 }],
  travel: [
    [0, 4, 3, 6, 5],
    [4, 0, 5, 4, 3],
    [3, 5, 0, 4, 6],
    [6, 4, 4, 0, 3],
    [5, 3, 6, 3, 0],
  ],
};

export const bundled: CoreInstance[] = [instanceA, instanceB];
