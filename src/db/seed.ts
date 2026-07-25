import * as schema from './schema';

/**
 * Realistic IOCL-style coastal network, Jul–Aug 2026.
 *
 * POL: six grades (HSD, MS, ATF, SKO, FO, Naphtha) moved coastally from marine
 * refineries (Gujarat/Koyali, Paradip, Haldia, CPCL-Chennai) to marketing
 * terminals down both coasts. Per-grade refinery output is balanced to coastal
 * demand. Vessels use realistic segregated-compartment layouts (product tankers
 * carry ~6 grades in a 6×2 tank arrangement). Compartment compatibility encodes
 * real transition rules — notably the EI/JIG jet (ATF) restrictions where a
 * residual (FO) prior cargo disqualifies the tank.
 *
 * Figures are illustrative but structurally grounded; not operational data.
 * Horizon day 0 = 2026-07-01.
 */
export async function seed(db: any) {
  const W = { start: '2026-07-01', end: '2026-08-31' };
  const C = (id: string, cap: number) => ({ id, cap });

  const products = [
    { id: 'p1', stream: 'POL', name: 'HSD', type: 'POL', color: '#f59e0b', cargoClass: 'CLEAN' },   // High-Speed Diesel
    { id: 'p2', stream: 'POL', name: 'MS', type: 'POL', color: '#ef4444', cargoClass: 'CLEAN' },    // Motor Spirit (petrol)
    { id: 'p3', stream: 'POL', name: 'ATF', type: 'POL', color: '#3b82f6', cargoClass: 'CLEAN' },   // Aviation Turbine Fuel (jet)
    { id: 'p4', stream: 'POL', name: 'SKO', type: 'POL', color: '#8b5cf6', cargoClass: 'CLEAN' },   // Superior Kerosene Oil
    { id: 'p9', stream: 'POL', name: 'FO', type: 'POL', color: '#a8a29e', cargoClass: 'BLACK' },    // Furnace Oil (residual / black oil)
    { id: 'p10', stream: 'POL', name: 'Naphtha', type: 'POL', color: '#14b8a6', cargoClass: 'CLEAN' },
    { id: 'p5', stream: 'CRUDE', name: 'Arab Light', type: 'CRUDE', color: '#10b981', cargoClass: 'CRUDE' },
    { id: 'p6', stream: 'CRUDE', name: 'Basrah Heavy', type: 'CRUDE', color: '#059669', cargoClass: 'CRUDE' },
    { id: 'p8', stream: 'LNG', name: 'LNG', type: 'LNG', color: '#ec4899', cargoClass: 'LNG' },
  ];

  // Marine refineries (coastal loading points) with the grades they export by sea.
  const polRef = [
    { id: 'l_koyali', name: 'Gujarat Refinery (Sikka)', lat: 22.43, lng: 69.84, makes: ['p1', 'p2', 'p3', 'p4', 'p9', 'p10'] },
    { id: 'l_paradip_ref', name: 'Paradip Refinery', lat: 20.27, lng: 86.68, makes: ['p1', 'p2', 'p3', 'p9', 'p10'] },
    { id: 'l_haldia_ref', name: 'Haldia Refinery', lat: 22.03, lng: 88.09, makes: ['p1', 'p2', 'p3', 'p4', 'p9'] },
    { id: 'l_cpcl', name: 'CPCL Chennai (Manali)', lat: 13.24, lng: 80.32, makes: ['p1', 'p2', 'p4', 'p9'] },
  ];
  // Coastal marketing terminals with daily offtake per grade (MT/day).
  const polTerm = [
    { id: 'l_kandla', name: 'Kandla Terminal', lat: 23.03, lng: 70.22, d: { p1: 1800, p2: 1200, p4: 500, p9: 700 } },
    { id: 'l_mumbai', name: 'Mumbai (JNPT) Terminal', lat: 18.95, lng: 72.95, d: { p1: 2200, p2: 1600, p3: 900, p10: 600 } },
    { id: 'l_goa', name: 'Goa Terminal', lat: 15.40, lng: 73.80, d: { p1: 900, p2: 600, p3: 400 } },
    { id: 'l_mangalore', name: 'New Mangalore Terminal', lat: 12.94, lng: 74.80, d: { p1: 1300, p2: 700, p4: 400 } },
    { id: 'l_kochi', name: 'Kochi Terminal', lat: 9.97, lng: 76.27, d: { p1: 1500, p2: 900, p3: 700, p4: 500 } },
    { id: 'l_vizag', name: 'Visakhapatnam Terminal', lat: 17.69, lng: 83.28, d: { p1: 1700, p2: 900, p9: 700, p4: 400 } },
    { id: 'l_krishnapatnam', name: 'Krishnapatnam Terminal', lat: 14.28, lng: 80.12, d: { p1: 1200, p2: 600 } },
    { id: 'l_tuticorin', name: 'Tuticorin Terminal', lat: 8.76, lng: 78.18, d: { p1: 1100, p2: 500, p4: 350 } },
    { id: 'l_ennore', name: 'Ennore Terminal', lat: 13.28, lng: 80.35, d: { p1: 1800, p2: 1000, p3: 600 } },
  ];
  const polProdIds = ['p1', 'p2', 'p3', 'p4', 'p9', 'p10'];
  const makesOf: Record<string, string[]> = {};
  for (const p of polProdIds) makesOf[p] = polRef.filter(r => r.makes.includes(p)).map(r => r.id);
  const cons: Record<string, number> = {};
  for (const p of polProdIds) cons[p] = 0;
  for (const t of polTerm) for (const [p, q] of Object.entries(t.d)) cons[p] += q as number;

  const locations: any[] = [], tanks: any[] = [], nodeFlows: any[] = [], berths: any[] = [], planLines: any[] = [];
  let tk = 0, nf = 0, bb = 0, pl = 0;
  const tag = (id: string) => id.replace('l_', '').slice(0, 5).toUpperCase();

  for (const r of polRef) {
    locations.push({ id: r.id, stream: 'POL', name: r.name, type: 'REFINERY', lat: r.lat, lng: r.lng });
    berths.push({ id: `b_${++bb}`, stream: 'POL', locationId: r.id, name: `${tag(r.id)}-J1`, nsim: 2, rateMtPerHr: 2800, berthingHours: 12, maxDraft: 15 });
    for (const p of r.makes) {
      const perRef = Math.round(cons[p] / Math.max(1, makesOf[p].length));
      tanks.push({ id: `t_${++tk}`, stream: 'POL', locationId: r.id, productId: p, capacity: 800000, minStock: 15000, currentStock: 150000, name: `${tag(r.id)}-${p}` });
      nodeFlows.push({ id: `nf_${++nf}`, stream: 'POL', locationId: r.id, productId: p, dailyIn: perRef, dailyOut: 0 });
      planLines.push({ id: `pl_${++pl}`, stream: 'POL', kind: 'SUPPLY', productId: p, locationId: r.id, qty: perRef * 62, windowStart: W.start, windowEnd: W.end, priority: 2 });
    }
  }
  for (const t of polTerm) {
    locations.push({ id: t.id, stream: 'POL', name: t.name, type: 'COASTAL_TERMINAL', lat: t.lat, lng: t.lng });
    berths.push({ id: `b_${++bb}`, stream: 'POL', locationId: t.id, name: `${tag(t.id)}-B1`, nsim: 1, rateMtPerHr: 1800, berthingHours: 12, maxDraft: 12.5 });
    for (const [p, q0] of Object.entries(t.d)) {
      const q = q0 as number;
      tanks.push({ id: `t_${++tk}`, stream: 'POL', locationId: t.id, productId: p, capacity: q * 42, minStock: q * 2, currentStock: q * 18, name: `${tag(t.id)}-${p}` });
      nodeFlows.push({ id: `nf_${++nf}`, stream: 'POL', locationId: t.id, productId: p, dailyIn: 0, dailyOut: q });
      planLines.push({ id: `pl_${++pl}`, stream: 'POL', kind: 'DEMAND', productId: p, locationId: t.id, qty: q * 62, windowStart: W.start, windowEnd: W.end, priority: q >= 1500 ? 1 : 2 });
    }
  }

  // ---- CRUDE (foreign sources → refinery crude farms) ----------------------
  const crudeLoc: any[] = [['l_ras_tanura', 'Ras Tanura (KSA)', 'SOURCE', 26.65, 50.15], ['l_basrah', 'Basrah Oil Terminal', 'SOURCE', 29.68, 48.80], ['l_paradip_crude', 'Paradip Crude Farm', 'CRUDE_STORAGE', 20.28, 86.62], ['l_mundra_crude', 'Mundra Crude Farm', 'CRUDE_STORAGE', 22.75, 69.70]];
  for (const [id, name, type, lat, lng] of crudeLoc) locations.push({ id, stream: 'CRUDE', name, type, lat, lng });
  const crudeTanks: any[] = [['l_ras_tanura', 2000000, 0, 500000], ['l_basrah', 2000000, 0, 450000], ['l_paradip_crude', 300000, 50000, 185000], ['l_mundra_crude', 250000, 40000, 150000]];
  for (const [loc, cap, mn, op] of crudeTanks) tanks.push({ id: `t_${++tk}`, stream: 'CRUDE', locationId: loc, productId: 'p5', capacity: cap, minStock: mn, currentStock: op, name: `${tag(loc as string)}-CR` });
  const crudeFlows: any[] = [['l_ras_tanura', 12000, 0], ['l_basrah', 10000, 0], ['l_paradip_crude', 0, 12000], ['l_mundra_crude', 0, 10000]];
  for (const [loc, di, dout] of crudeFlows) { nodeFlows.push({ id: `nf_${++nf}`, stream: 'CRUDE', locationId: loc, productId: 'p5', dailyIn: di, dailyOut: dout }); if (dout) planLines.push({ id: `pl_${++pl}`, stream: 'CRUDE', kind: 'DEMAND', productId: 'p5', locationId: loc, qty: (dout as number) * 62, windowStart: W.start, windowEnd: W.end, priority: 1 }); }
  for (const [loc, name, nsim, rate, md] of [['l_ras_tanura', 'RT-SBM', 2, 8000, 22], ['l_basrah', 'BAS-SBM', 2, 8000, 22], ['l_paradip_crude', 'PDP-SPM', 1, 8000, 21], ['l_mundra_crude', 'MND-SPM', 1, 8000, 21]] as any[]) berths.push({ id: `b_${++bb}`, stream: 'CRUDE', locationId: loc, name, nsim, rateMtPerHr: rate, berthingHours: 18, maxDraft: md });

  // ---- LNG (foreign sources → regas terminals) -----------------------------
  const lngLoc: any[] = [['l_qatar', 'Ras Laffan (Qatar)', 'SOURCE', 25.91, 51.55], ['l_australia', 'Gorgon (Australia)', 'SOURCE', -20.80, 115.45], ['l_dahej', 'Dahej LNG Terminal', 'LNG_TERMINAL', 21.71, 72.59], ['l_ennore_lng', 'Ennore LNG Terminal', 'LNG_TERMINAL', 13.26, 80.33]];
  for (const [id, name, type, lat, lng] of lngLoc) locations.push({ id, stream: 'LNG', name, type, lat, lng });
  const lngTanks: any[] = [['l_qatar', 2000000, 0, 500000], ['l_australia', 2000000, 0, 450000], ['l_dahej', 200000, 20000, 120000], ['l_ennore_lng', 180000, 15000, 100000]];
  for (const [loc, cap, mn, op] of lngTanks) tanks.push({ id: `t_${++tk}`, stream: 'LNG', locationId: loc, productId: 'p8', capacity: cap, minStock: mn, currentStock: op, name: `${tag(loc as string)}-LNG` });
  const lngFlows: any[] = [['l_qatar', 8000, 0], ['l_australia', 7000, 0], ['l_dahej', 0, 8000], ['l_ennore_lng', 0, 7000]];
  for (const [loc, di, dout] of lngFlows) { nodeFlows.push({ id: `nf_${++nf}`, stream: 'LNG', locationId: loc, productId: 'p8', dailyIn: di, dailyOut: dout }); if (dout) planLines.push({ id: `pl_${++pl}`, stream: 'LNG', kind: 'DEMAND', productId: 'p8', locationId: loc, qty: (dout as number) * 62, windowStart: W.start, windowEnd: W.end, priority: 1 }); }
  for (const [loc, name, nsim, md] of [['l_qatar', 'QAT-J1', 2, 14], ['l_australia', 'AUS-J1', 2, 14], ['l_dahej', 'DHJ-J1', 1, 13], ['l_ennore_lng', 'ENN-J1', 1, 13]] as any[]) berths.push({ id: `b_${++bb}`, stream: 'LNG', locationId: loc, name, nsim, rateMtPerHr: 6000, berthingHours: 18, maxDraft: md });

  // ---- Fleets — realistic classes & segregated compartments ----------------
  const V = (id: string, stream: string, name: string, cls: string, dwt: number, pool: string, speed: number, hire: number, voy: number, dl: number, db: number, comps: any[], service?: string) =>
    ({ id, stream, name, class: cls, dwt, charterType: pool === 'SPOT' ? 'VOYAGE' : 'TC', pool, service: service ?? (stream === 'POL' ? 'CLEAN' : stream), speed, charterCost: hire, voyageRate: voy, availFrom: null, availTo: null, draftLaden: dl, draftBallast: db, compartments: comps });
  const vessels = [
    // POL owned/TC — MR/LR/Handysize product tankers with 5–8 segregations
    V('v_pol1', 'POL', 'MT Swarna Godavari', 'MR', 47000, 'TC', 13.0, 15500, 0, 11.0, 6.5, [C('1P', 9000), C('2P', 8500), C('3P', 8000), C('1S', 7000), C('2S', 6500), C('3S', 6000)]),
    V('v_pol2', 'POL', 'MT Desh Shakti', 'LR1', 68000, 'TC', 14.0, 22000, 0, 12.2, 7.0, [C('1C', 12000), C('2P', 11000), C('2S', 11000), C('3P', 10000), C('3S', 9500), C('4C', 9500)]),
    V('v_pol3', 'POL', 'MT Nandeshwari', 'MR', 45000, 'OWNED', 12.5, 14000, 0, 11.0, 6.5, [C('1P', 9000), C('2P', 8000), C('3P', 8000), C('1S', 7000), C('2S', 6500), C('3S', 6500)]),
    V('v_pol4', 'POL', 'MT Kandla', 'Handysize', 38000, 'OWNED', 12.0, 12000, 0, 10.2, 6.0, [C('1P', 8000), C('2P', 7500), C('3P', 7000), C('1S', 6500), C('2S', 5000), C('3S', 4000)]),
    V('v_pol5', 'POL', 'MT Ganga', 'MR', 50000, 'TC', 13.5, 18000, 0, 11.5, 6.5, [C('1P', 10000), C('2P', 9000), C('3P', 9000), C('1S', 8000), C('2S', 7000), C('3S', 7000)]),
    V('v_pol6', 'POL', 'MT Vishwa Vijeta', 'LR2', 110000, 'TC', 14.5, 30000, 0, 13.0, 7.5, [C('1P', 14000), C('1S', 13000), C('2P', 13000), C('2S', 12000), C('3P', 12000), C('3S', 12000), C('4P', 12000), C('4S', 12000)]),
    // POL spot pool
    V('v_pol_s1', 'POL', 'Spot MR Alpha', 'MR', 47000, 'SPOT', 13.0, 0, 14, 11.0, 6.5, [C('1P', 9000), C('2P', 8500), C('3P', 8000), C('1S', 7000), C('2S', 6500), C('3S', 6000)]),
    V('v_pol_s2', 'POL', 'Spot LR1 Bravo', 'LR1', 72000, 'SPOT', 14.0, 0, 12, 12.4, 7.0, [C('1C', 12000), C('2P', 12000), C('2S', 12000), C('3P', 12000), C('3S', 11000), C('4C', 9000)]),
    V('v_pol_s3', 'POL', 'Spot MR Charlie', 'MR', 46000, 'SPOT', 13.0, 0, 15, 11.0, 6.5, [C('1P', 9000), C('2P', 8000), C('3P', 8000), C('1S', 7000), C('2S', 7000), C('3S', 6000)]),
    V('v_pol_s4', 'POL', 'Spot Handy Delta', 'Handysize', 35000, 'SPOT', 12.5, 0, 16, 10.0, 5.8, [C('1P', 7500), C('2P', 7000), C('3P', 6500), C('1S', 6000), C('2S', 5000), C('3S', 3000)]),
    // POL black-oil (dirty) tankers — carry FO only, never mixed with clean-product vessels
    V('v_pol_fo1', 'POL', 'MT Jag Pratap', 'MR', 45000, 'OWNED', 12.5, 13500, 0, 11.0, 6.5, [C('1C', 15000), C('2C', 15000), C('3C', 15000)], 'BLACK'),
    V('v_pol_fo2', 'POL', 'Spot Dirty Echo', 'MR', 46000, 'SPOT', 12.5, 0, 13, 11.0, 6.5, [C('1C', 15500), C('2C', 15500), C('3C', 15000)], 'BLACK'),
    // CRUDE — Aframax/Suezmax/VLCC (few large segregations)
    V('v_cru1', 'CRUDE', 'MT Kutch', 'VLCC', 300000, 'TC', 14.5, 35000, 0, 20.5, 10.0, [C('C1', 100000), C('C2', 95000), C('C3', 85000)]),
    V('v_cru2', 'CRUDE', 'MT Saurashtra', 'Suezmax', 150000, 'OWNED', 14.0, 28000, 0, 16.0, 9.0, [C('C1', 50000), C('C2', 50000), C('C3', 45000)]),
    V('v_cru3', 'CRUDE', 'MT Ocean King', 'Aframax', 110000, 'TC', 13.5, 22000, 0, 14.2, 8.0, [C('C1', 40000), C('C2', 35000), C('C3', 30000)]),
    V('v_cru_s1', 'CRUDE', 'Spot VLCC Ceres', 'VLCC', 300000, 'SPOT', 14.5, 0, 8, 20.5, 10.0, [C('C1', 150000), C('C2', 130000)]),
    V('v_cru_s2', 'CRUDE', 'Spot Suezmax Nord', 'Suezmax', 158000, 'SPOT', 14.0, 0, 9, 16.2, 9.0, [C('C1', 78000), C('C2', 72000)]),
    // LNG — LNGC
    V('v_lng1', 'LNG', 'LNG Bharat', 'LNGC', 90000, 'TC', 18.0, 65000, 0, 12.0, 9.0, [C('T1', 45000), C('T2', 45000)]),
    V('v_lng2', 'LNG', 'LNG Prachi', 'LNGC', 85000, 'OWNED', 17.5, 62000, 0, 12.0, 9.0, [C('T1', 42500), C('T2', 42500)]),
    V('v_lng_s1', 'LNG', 'Spot LNGC Aegean', 'LNGC', 90000, 'SPOT', 18.0, 0, 30, 12.0, 9.0, [C('T1', 45000), C('T2', 45000)]),
    V('v_lng_s2', 'LNG', 'Spot LNGC Pacific', 'LNGC', 88000, 'SPOT', 18.0, 0, 30, 12.0, 9.0, [C('T1', 44000), C('T2', 44000)]),
  ];

  // ---- Compartment compatibility (from → to). Unlisted pairs default allowed, 0 cost.
  // Grounded in real transition practice: jet (ATF) is strict (FO prior forbidden →
  // drives the EI/JIG last-3 rule); residual FO → clean needs heavy cleaning; clean
  // grades interchange cheaply; clean → FO (downgrade) is easy.
  const compatRows: Array<[string, string, string, number, number, number]> = [
    // into ATF (jet)
    ['POL', 'p4', 'p3', 1, 6, 80000],    // SKO → ATF (kerosene ≈ jet)
    ['POL', 'p1', 'p3', 1, 24, 400000],  // HSD → ATF
    ['POL', 'p10', 'p3', 1, 18, 300000], // Naphtha → ATF
    ['POL', 'p2', 'p3', 1, 24, 450000],  // MS → ATF
    ['POL', 'p9', 'p3', 0, 0, 0],        // FO → ATF FORBIDDEN (residual disqualifies jet)
    // residual FO → clean grades (heavy clean)
    ['POL', 'p9', 'p1', 1, 18, 250000], ['POL', 'p9', 'p2', 1, 18, 250000], ['POL', 'p9', 'p4', 1, 18, 250000], ['POL', 'p9', 'p10', 1, 18, 250000],
    // clean interchange
    ['POL', 'p1', 'p2', 1, 6, 60000], ['POL', 'p2', 'p1', 1, 6, 60000],
    ['POL', 'p1', 'p4', 1, 4, 30000], ['POL', 'p4', 'p1', 1, 4, 30000],
    ['POL', 'p2', 'p10', 1, 8, 90000], ['POL', 'p10', 'p2', 1, 8, 90000],
    ['POL', 'p3', 'p1', 1, 6, 60000], ['POL', 'p3', 'p2', 1, 6, 60000], ['POL', 'p3', 'p4', 1, 4, 20000],
    // clean → FO (downgrade, easy)
    ['POL', 'p1', 'p9', 1, 4, 20000], ['POL', 'p2', 'p9', 1, 4, 20000], ['POL', 'p4', 'p9', 1, 4, 20000], ['POL', 'p10', 'p9', 1, 4, 20000],
    // crude grades
    ['CRUDE', 'p5', 'p6', 1, 12, 200000], ['CRUDE', 'p6', 'p5', 1, 12, 200000],
  ];
  const productCompatibility = compatRows.map(([stream, from, to, allowed, hrs, cost], i) => ({ id: `pc_${i + 1}`, stream, scope: 'COMPARTMENT', fromProduct: from, toProduct: to, allowed, changeoverHours: hrs, changeoverCost: cost }));

  await db.insert(schema.products).values(products);
  await db.insert(schema.locations).values(locations);
  await db.insert(schema.vessels).values(vessels);
  await db.insert(schema.tanks).values(tanks);
  await db.insert(schema.nodeFlows).values(nodeFlows);
  await db.insert(schema.planLines).values(planLines);
  await db.insert(schema.berths).values(berths);
  await db.insert(schema.productCompatibility).values(productCompatibility);
}
