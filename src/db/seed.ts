import * as schema from './schema';

/**
 * IOCL-grounded coastal MIRP network, Jul–Aug 2026 (horizon day 0 = 2026-07-01).
 *
 * Grounded in public facts about Indian Oil (IOCL ~80.55 MMTPA across 11 refineries,
 * ~13,000 km product pipelines) and its coastal logistics, then made internally
 * consistent so the solver always has a feasible plan. Figures are ILLUSTRATIVE —
 * not operational data, prices, or real customer volumes.
 *
 * POL (product tankers): the four IOCL refineries with marine export access load
 * ten grades by sea to marketing terminals down both coasts:
 *   - Gujarat Refinery / Koyali (13.7 MMTPA) exporting via Sikka, Gulf of Kutch
 *   - Paradip Refinery (15.0 MMTPA), deep-draft east coast
 *   - Haldia Refinery (8.0 MMTPA), draft-constrained on the Hooghly (MR-max)
 *   - CPCL Manali / Chennai (10.5 MMTPA)
 * Grades: HSD, MS, ATF, SKO, Naphtha and the two branded SKUs XtraPremium (MS) and
 * XtraGreen (HSD) are CLEAN white oils; FO and LSHS are BLACK residuals; Bitumen is
 * a heated, dedicated cargo. Three-way segregation is enforced by vessel service:
 * CLEAN product tankers, BLACK (dirty) tankers, and a dedicated BITUMEN carrier never
 * mix. Compartment transition rules encode the real jet (ATF) restriction — a residual
 * (FO/LSHS) prior cargo disqualifies the tank (the EI/JIG last-cargo rule).
 *
 * Fleet uses SCI-style names (Swarna product tankers, Desh crude tankers, and the
 * Disha/Raahi/Aseem LNG carriers) at realistic class DWT/draft/compartment counts.
 * Port drafts tier the fleet: LR2 (~13 m) is barred from Haldia/Kandla/Mumbai; MRs
 * and Handysize reach everywhere; the deep terminals (Paradip 17 m, Krishnapatnam 16 m)
 * take anything.
 *
 * CRUDE: four import grades (Arab Light, Basrah Heavy, Murban, Urals) on VLCC/Suezmax/
 * Aframax to refinery crude farms (Vadinar, Paradip, Chennai, Mumbai).
 * LNG: Qatar/Australia to the Dahej, Ennore and Kochi regas terminals on LNG carriers.
 */
export async function seed(db: any) {
  const W = { start: '2026-07-01', end: '2026-08-31' };
  const DAYS = 62;
  const C = (id: string, cap: number) => ({ id, cap });
  const c6 = (a: number, b: number, c: number, d: number, e: number, f: number) =>
    [C('1P', a), C('2P', b), C('3P', c), C('1S', d), C('2S', e), C('3S', f)];
  const c8 = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) =>
    [C('1P', a), C('1S', b), C('2P', c), C('2S', d), C('3P', e), C('3S', f), C('4P', g), C('4S', h)];
  const c3 = (a: number, b: number, c: number) => [C('1C', a), C('2C', b), C('3C', c)];

  // ---- Products (grades / SKUs) --------------------------------------------
  const products = [
    // POL — CLEAN white oils
    { id: 'p1', stream: 'POL', name: 'HSD', type: 'POL', color: '#f59e0b', cargoClass: 'CLEAN' },        // High-Speed Diesel (BS-VI)
    { id: 'p2', stream: 'POL', name: 'MS', type: 'POL', color: '#ef4444', cargoClass: 'CLEAN' },         // Motor Spirit / petrol (BS-VI)
    { id: 'p3', stream: 'POL', name: 'ATF', type: 'POL', color: '#3b82f6', cargoClass: 'CLEAN' },        // Aviation Turbine Fuel (Jet A-1)
    { id: 'p4', stream: 'POL', name: 'SKO', type: 'POL', color: '#8b5cf6', cargoClass: 'CLEAN' },        // Superior Kerosene Oil
    { id: 'p10', stream: 'POL', name: 'Naphtha', type: 'POL', color: '#14b8a6', cargoClass: 'CLEAN' },
    { id: 'p13', stream: 'POL', name: 'XtraPremium', type: 'POL', color: '#f97316', cargoClass: 'CLEAN' }, // branded premium MS
    { id: 'p14', stream: 'POL', name: 'XtraGreen', type: 'POL', color: '#22c55e', cargoClass: 'CLEAN' },   // branded premium HSD
    // POL — BLACK residuals (dirty tankers only)
    { id: 'p9', stream: 'POL', name: 'FO', type: 'POL', color: '#a8a29e', cargoClass: 'BLACK' },         // Furnace Oil
    { id: 'p11', stream: 'POL', name: 'LSHS', type: 'POL', color: '#78716c', cargoClass: 'BLACK' },      // Low Sulphur Heavy Stock
    // POL — Bitumen (heated, dedicated carrier only)
    { id: 'p12', stream: 'POL', name: 'Bitumen', type: 'POL', color: '#44403c', cargoClass: 'BITUMEN' },
    // CRUDE — import grades
    { id: 'p5', stream: 'CRUDE', name: 'Arab Light', type: 'CRUDE', color: '#10b981', cargoClass: 'CRUDE' },
    { id: 'p6', stream: 'CRUDE', name: 'Basrah Heavy', type: 'CRUDE', color: '#059669', cargoClass: 'CRUDE' },
    { id: 'p7', stream: 'CRUDE', name: 'Murban', type: 'CRUDE', color: '#34d399', cargoClass: 'CRUDE' },
    { id: 'p16', stream: 'CRUDE', name: 'Urals', type: 'CRUDE', color: '#047857', cargoClass: 'CRUDE' },
    // LNG
    { id: 'p8', stream: 'LNG', name: 'LNG', type: 'LNG', color: '#ec4899', cargoClass: 'LNG' },
  ];

  // ---- POL refineries (marine loading points) ------------------------------
  // capMMTPA is annotation only; berth draft tiers the fleet (Haldia is MR-max).
  const polRef = [
    { id: 'l_koyali', name: 'Gujarat Refinery (Sikka)', lat: 22.43, lng: 69.84, draft: 14.0, berths: 2, capMMTPA: 13.7, makes: ['p1', 'p2', 'p3', 'p4', 'p10', 'p13', 'p14', 'p9', 'p11', 'p12'] },
    { id: 'l_paradip_ref', name: 'Paradip Refinery', lat: 20.27, lng: 86.68, draft: 17.0, berths: 2, capMMTPA: 15.0, makes: ['p1', 'p2', 'p3', 'p4', 'p10', 'p13', 'p14', 'p9', 'p11'] },
    { id: 'l_haldia_ref', name: 'Haldia Refinery', lat: 22.03, lng: 88.09, draft: 11.5, berths: 2, capMMTPA: 8.0, makes: ['p1', 'p2', 'p3', 'p4', 'p9', 'p11', 'p12'] },
    { id: 'l_cpcl', name: 'CPCL Chennai (Manali)', lat: 13.24, lng: 80.32, draft: 15.0, berths: 2, capMMTPA: 10.5, makes: ['p1', 'p2', 'p3', 'p4', 'p9', 'p11', 'p12'] },
  ];

  // ---- POL marketing terminals (daily offtake per grade, MT/day) -----------
  const polTerm = [
    // West coast
    { id: 'l_kandla', name: 'Kandla Terminal', lat: 23.03, lng: 70.22, draft: 12.5, d: { p1: 1900, p2: 1300, p4: 500, p9: 700, p11: 300 } },
    { id: 'l_pipavav', name: 'Pipavav Terminal', lat: 20.92, lng: 71.53, draft: 12.0, d: { p1: 700, p2: 400 } },
    { id: 'l_mumbai', name: 'Mumbai (Pir Pau) Terminal', lat: 18.95, lng: 72.95, draft: 12.0, d: { p1: 2300, p2: 1500, p3: 1000, p13: 400, p14: 400, p10: 600 } },
    { id: 'l_goa', name: 'Goa (Mormugao) Terminal', lat: 15.40, lng: 73.80, draft: 13.0, d: { p1: 900, p2: 600, p3: 400 } },
    { id: 'l_mangalore', name: 'New Mangalore Terminal', lat: 12.94, lng: 74.80, draft: 14.0, d: { p1: 1300, p2: 800, p4: 400, p9: 400 } },
    { id: 'l_kochi', name: 'Kochi Terminal', lat: 9.97, lng: 76.27, draft: 13.0, d: { p1: 1600, p2: 900, p3: 700, p4: 500, p13: 300 } },
    // East / south coast
    { id: 'l_tuticorin', name: 'Tuticorin (V.O.C.) Terminal', lat: 8.76, lng: 78.18, draft: 12.8, d: { p1: 1100, p2: 500, p4: 350 } },
    { id: 'l_ennore', name: 'Ennore (Kamarajar) Terminal', lat: 13.28, lng: 80.35, draft: 13.0, d: { p1: 1800, p2: 1000, p3: 600, p14: 300, p12: 150 } },
    { id: 'l_krishnapatnam', name: 'Krishnapatnam Terminal', lat: 14.28, lng: 80.12, draft: 16.0, d: { p1: 1200, p2: 600, p12: 200 } },
    { id: 'l_kakinada', name: 'Kakinada Terminal', lat: 16.96, lng: 82.25, draft: 12.0, d: { p1: 800, p2: 400, p10: 300 } },
    { id: 'l_vizag', name: 'Visakhapatnam Terminal', lat: 17.69, lng: 83.28, draft: 14.0, d: { p1: 1700, p2: 900, p9: 700, p4: 400, p11: 300 } },
  ];

  const polProdIds = ['p1', 'p2', 'p3', 'p4', 'p10', 'p13', 'p14', 'p9', 'p11', 'p12'];
  const makesOf: Record<string, string[]> = {};
  for (const p of polProdIds) makesOf[p] = polRef.filter(r => r.makes.includes(p)).map(r => r.id);
  const cons: Record<string, number> = {};
  for (const p of polProdIds) cons[p] = 0;
  for (const t of polTerm) for (const [p, q] of Object.entries(t.d)) cons[p] += q as number;

  const locations: any[] = [], tanks: any[] = [], nodeFlows: any[] = [], berths: any[] = [], planLines: any[] = [];
  let tk = 0, nf = 0, bb = 0, pl = 0;
  const tag = (id: string) => id.replace('l_', '').slice(0, 5).toUpperCase();

  // Refineries: supply each grade split evenly across the refineries that make it,
  // balanced to total coastal demand for that grade (plus a generous opening buffer).
  for (const r of polRef) {
    locations.push({ id: r.id, stream: 'POL', name: r.name, type: 'REFINERY', lat: r.lat, lng: r.lng });
    berths.push({ id: `b_${++bb}`, stream: 'POL', locationId: r.id, name: `${tag(r.id)}-JETTY`, nsim: r.berths, rateMtPerHr: 2800, berthingHours: 12, maxDraft: r.draft });
    for (const p of r.makes) {
      const perRef = Math.round(cons[p] / Math.max(1, makesOf[p].length));
      tanks.push({ id: `t_${++tk}`, stream: 'POL', locationId: r.id, productId: p, capacity: 1200000, minStock: 20000, currentStock: 300000, name: `${tag(r.id)}-${p}` });
      nodeFlows.push({ id: `nf_${++nf}`, stream: 'POL', locationId: r.id, productId: p, dailyIn: perRef, dailyOut: 0 });
      if (perRef > 0) planLines.push({ id: `pl_${++pl}`, stream: 'POL', kind: 'SUPPLY', productId: p, locationId: r.id, qty: perRef * DAYS, windowStart: W.start, windowEnd: W.end, priority: 2 });
    }
  }
  // Terminals: draw down at the daily offtake; opening ≈ 20 days, floor 2 days, tank-top ceiling ×45.
  for (const t of polTerm) {
    locations.push({ id: t.id, stream: 'POL', name: t.name, type: 'COASTAL_TERMINAL', lat: t.lat, lng: t.lng });
    berths.push({ id: `b_${++bb}`, stream: 'POL', locationId: t.id, name: `${tag(t.id)}-BERTH`, nsim: 1, rateMtPerHr: 1800, berthingHours: 12, maxDraft: t.draft });
    for (const [p, q0] of Object.entries(t.d)) {
      const q = q0 as number;
      // Bitumen moves in seasonal campaigns on a single dedicated carrier: give it
      // horizon-sized heated storage so one early lift covers the window (no late refill).
      const big = p === 'p12';
      tanks.push({ id: `t_${++tk}`, stream: 'POL', locationId: t.id, productId: p, capacity: q * (big ? 80 : 45), minStock: q * 2, currentStock: q * (big ? 38 : 20), name: `${tag(t.id)}-${p}` });
      nodeFlows.push({ id: `nf_${++nf}`, stream: 'POL', locationId: t.id, productId: p, dailyIn: 0, dailyOut: q });
      planLines.push({ id: `pl_${++pl}`, stream: 'POL', kind: 'DEMAND', productId: p, locationId: t.id, qty: q * DAYS, windowStart: W.start, windowEnd: W.end, priority: q >= 1500 ? 1 : 2 });
    }
  }

  // ---- CRUDE (import grades → refinery crude farms) -------------------------
  const crudeSrc: any[] = [
    ['l_ras_tanura', 'Ras Tanura (Saudi Aramco)', 26.65, 50.15, 'p5'],
    ['l_basrah', 'Basrah Oil Terminal (Iraq)', 29.68, 48.80, 'p6'],
    ['l_fujairah', 'Fujairah (Murban, UAE)', 25.12, 56.33, 'p7'],
    ['l_novorossiysk', 'Novorossiysk (Urals, Russia)', 44.72, 37.79, 'p16'],
  ];
  const crudeFarm: any[] = [
    ['l_vadinar_crude', 'Vadinar Crude Farm', 22.28, 69.73, 'p5', 12000],
    ['l_paradip_crude', 'Paradip Crude Farm', 20.28, 86.62, 'p6', 12000],
    ['l_chennai_crude', 'Chennai (Manali) Crude Farm', 13.10, 80.30, 'p7', 9000],
    ['l_mumbai_crude', 'Mumbai Crude Farm', 18.90, 72.80, 'p16', 8000],
  ];
  for (const [id, name, lat, lng, grade] of crudeSrc) {
    locations.push({ id, stream: 'CRUDE', name, type: 'SOURCE', lat, lng });
    tanks.push({ id: `t_${++tk}`, stream: 'CRUDE', locationId: id, productId: grade, capacity: 3000000, minStock: 0, currentStock: 700000, name: `${tag(id)}-CR` });
    nodeFlows.push({ id: `nf_${++nf}`, stream: 'CRUDE', locationId: id, productId: grade, dailyIn: 15000, dailyOut: 0 });
    berths.push({ id: `b_${++bb}`, stream: 'CRUDE', locationId: id, name: `${tag(id)}-SBM`, nsim: 2, rateMtPerHr: 8000, berthingHours: 18, maxDraft: 22 });
  }
  for (const [id, name, lat, lng, grade, dout] of crudeFarm) {
    locations.push({ id, stream: 'CRUDE', name, type: 'CRUDE_STORAGE', lat, lng });
    tanks.push({ id: `t_${++tk}`, stream: 'CRUDE', locationId: id, productId: grade, capacity: 600000, minStock: 60000, currentStock: 280000, name: `${tag(id)}-CR` });
    nodeFlows.push({ id: `nf_${++nf}`, stream: 'CRUDE', locationId: id, productId: grade, dailyIn: 0, dailyOut: dout });
    planLines.push({ id: `pl_${++pl}`, stream: 'CRUDE', kind: 'DEMAND', productId: grade, locationId: id, qty: (dout as number) * DAYS, windowStart: W.start, windowEnd: W.end, priority: 1 });
    berths.push({ id: `b_${++bb}`, stream: 'CRUDE', locationId: id, name: `${tag(id)}-SPM`, nsim: 1, rateMtPerHr: 8000, berthingHours: 18, maxDraft: 21 });
  }

  // ---- LNG (Qatar / Australia → regas terminals) ---------------------------
  const lngSrc: any[] = [['l_qatar', 'Ras Laffan (Qatar)', 25.91, 51.55], ['l_australia', 'Gorgon (Australia)', -20.80, 115.45]];
  const lngTerm: any[] = [['l_dahej', 'Dahej LNG Terminal', 21.71, 72.59, 8000], ['l_ennore_lng', 'Ennore LNG Terminal', 13.26, 80.33, 6000], ['l_kochi_lng', 'Kochi (Puthuvype) LNG Terminal', 9.98, 76.24, 4000]];
  for (const [id, name, lat, lng] of lngSrc) {
    locations.push({ id, stream: 'LNG', name, type: 'SOURCE', lat, lng });
    tanks.push({ id: `t_${++tk}`, stream: 'LNG', locationId: id, productId: 'p8', capacity: 2500000, minStock: 0, currentStock: 600000, name: `${tag(id)}-LNG` });
    nodeFlows.push({ id: `nf_${++nf}`, stream: 'LNG', locationId: id, productId: 'p8', dailyIn: 11000, dailyOut: 0 });
    berths.push({ id: `b_${++bb}`, stream: 'LNG', locationId: id, name: `${tag(id)}-J1`, nsim: 2, rateMtPerHr: 6000, berthingHours: 18, maxDraft: 14 });
  }
  for (const [id, name, lat, lng, dout] of lngTerm) {
    locations.push({ id, stream: 'LNG', name, type: 'LNG_TERMINAL', lat, lng });
    tanks.push({ id: `t_${++tk}`, stream: 'LNG', locationId: id, productId: 'p8', capacity: 220000, minStock: 20000, currentStock: 120000, name: `${tag(id)}-LNG` });
    nodeFlows.push({ id: `nf_${++nf}`, stream: 'LNG', locationId: id, productId: 'p8', dailyIn: 0, dailyOut: dout });
    planLines.push({ id: `pl_${++pl}`, stream: 'LNG', kind: 'DEMAND', productId: 'p8', locationId: id, qty: (dout as number) * DAYS, windowStart: W.start, windowEnd: W.end, priority: 1 });
    berths.push({ id: `b_${++bb}`, stream: 'LNG', locationId: id, name: `${tag(id)}-J1`, nsim: 1, rateMtPerHr: 6000, berthingHours: 18, maxDraft: 13 });
  }

  // ---- Fleets — SCI-style names, realistic class DWT / draft / segregations --
  const V = (id: string, stream: string, name: string, cls: string, dwt: number, pool: string, speed: number, hire: number, voy: number, dl: number, db: number, comps: any[], service?: string) =>
    ({ id, stream, name, class: cls, dwt, charterType: pool === 'SPOT' ? 'VOYAGE' : pool === 'COA' ? 'COA' : 'TC', pool, service: service ?? (stream === 'POL' ? 'CLEAN' : stream), speed, charterCost: hire, voyageRate: voy, availFrom: null, availTo: null, draftLaden: dl, draftBallast: db, compartments: comps });
  // Charter pools: OWNED (IOCL/SCI hulls), TC (whole-ship time charter), COA (Contract of
  // Affreightment — committed volume tonnage), SPOT (single-voyage charter, the recommend pool).
  const vessels = [
    // POL CLEAN product tankers (owned / TC) — Swarna series
    V('v_pol1', 'POL', 'MT Swarna Godavari', 'MR', 46000, 'OWNED', 13.0, 15500, 0, 11.0, 6.5, c6(9000, 8500, 8000, 7500, 7000, 6000)),
    V('v_pol2', 'POL', 'MT Swarna Kaveri', 'MR', 46000, 'COA', 13.0, 14500, 0, 11.0, 6.5, c6(9000, 8500, 8000, 7500, 7000, 6000)),
    V('v_pol3', 'POL', 'MT Swarna Pushp', 'Handysize', 37000, 'OWNED', 12.0, 12000, 0, 10.2, 6.0, c6(6500, 6500, 6000, 6000, 5500, 5500)),
    V('v_pol4', 'POL', 'MT Swarna Sindhu', 'LR1', 74000, 'TC', 14.0, 22000, 0, 12.2, 7.0, c6(13000, 13000, 12500, 12000, 12000, 11500)),
    V('v_pol5', 'POL', 'MT Swarna Krishna', 'LR1', 73000, 'OWNED', 14.0, 21000, 0, 12.2, 7.0, c6(13000, 12500, 12500, 12000, 12000, 11000)),
    V('v_pol6', 'POL', 'MT Swarna Jayanti', 'LR2', 110000, 'TC', 14.5, 30000, 0, 13.0, 7.5, c8(14000, 14000, 13500, 13500, 13500, 13500, 14000, 14000)),
    V('v_pol7', 'POL', 'MT Swarna Mala', 'MR', 48000, 'COA', 13.2, 15500, 0, 11.1, 6.6, c6(9500, 9000, 8500, 8000, 7000, 6000)),
    // POL CLEAN spot pool
    V('v_pol_s1', 'POL', 'Spot MR Alpha', 'MR', 46000, 'SPOT', 13.0, 0, 14, 11.0, 6.5, c6(9000, 8500, 8000, 7500, 7000, 6000)),
    V('v_pol_s2', 'POL', 'Spot LR1 Bravo', 'LR1', 73000, 'SPOT', 14.0, 0, 12, 12.3, 7.0, c6(13000, 12500, 12500, 12000, 12000, 11000)),
    V('v_pol_s3', 'POL', 'Spot MR Charlie', 'MR', 45000, 'SPOT', 13.0, 0, 15, 11.0, 6.5, c6(9000, 8000, 8000, 7500, 7000, 5500)),
    V('v_pol_s4', 'POL', 'Spot Handy Delta', 'Handysize', 35000, 'SPOT', 12.5, 0, 16, 10.0, 5.8, c6(6500, 6000, 6000, 5500, 5500, 5500)),
    V('v_pol_s5', 'POL', 'Spot LR2 Foxtrot', 'LR2', 112000, 'SPOT', 14.5, 0, 10, 13.1, 7.6, c8(14500, 14000, 14000, 14000, 14000, 13500, 14000, 14000)),
    // POL BLACK residual (FO / LSHS) tankers — never mixed with clean product
    V('v_pol_fo1', 'POL', 'MT Jag Pratap', 'MR', 45000, 'OWNED', 12.5, 13500, 0, 11.0, 6.5, c3(15000, 15000, 15000), 'BLACK'),
    V('v_pol_fo2', 'POL', 'MT Maharshi Karve', 'MR', 46000, 'TC', 12.5, 13800, 0, 11.0, 6.5, c3(15500, 15500, 15000), 'BLACK'),
    V('v_pol_fo3', 'POL', 'Spot Dirty Echo', 'MR', 46000, 'SPOT', 12.5, 0, 13, 11.0, 6.5, c3(15500, 15500, 15000), 'BLACK'),
    // POL Bitumen — dedicated heated carrier (never mixed with anything); spot pool for peaks
    V('v_pol_bit', 'POL', 'MT Asphalt Pioneer', 'Bitumen Carrier', 12000, 'OWNED', 11.5, 9000, 0, 7.5, 4.5, [C('1', 3000), C('2', 3000), C('3', 3000), C('4', 3000)], 'BITUMEN'),
    V('v_pol_bit_s', 'POL', 'Spot Bitumen Trader', 'Bitumen Carrier', 11000, 'SPOT', 11.5, 0, 22, 7.3, 4.4, [C('1', 3000), C('2', 3000), C('3', 3000)], 'BITUMEN'),
    // CRUDE — Desh series (Aframax / Suezmax / VLCC)
    V('v_cru1', 'CRUDE', 'MT Desh Ujaala', 'VLCC', 300000, 'TC', 14.5, 35000, 0, 20.5, 10.0, c3(105000, 100000, 95000)),
    V('v_cru2', 'CRUDE', 'MT Desh Shakti', 'Suezmax', 158000, 'OWNED', 14.0, 28000, 0, 16.0, 9.0, c3(55000, 53000, 50000)),
    V('v_cru3', 'CRUDE', 'MT Desh Vaibhav', 'Aframax', 110000, 'COA', 13.5, 21500, 0, 14.2, 8.0, c3(40000, 37000, 33000)),
    V('v_cru4', 'CRUDE', 'MT Desh Gaurav', 'Suezmax', 157000, 'OWNED', 14.0, 27000, 0, 16.0, 9.0, c3(55000, 52000, 50000)),
    V('v_cru_s1', 'CRUDE', 'Spot VLCC Ceres', 'VLCC', 300000, 'SPOT', 14.5, 0, 8, 20.5, 10.0, [C('C1', 150000), C('C2', 150000)]),
    V('v_cru_s2', 'CRUDE', 'Spot Suezmax Nord', 'Suezmax', 158000, 'SPOT', 14.0, 0, 9, 16.2, 9.0, [C('C1', 80000), C('C2', 78000)]),
    // LNG — Disha / Raahi / Aseem + spot
    V('v_lng1', 'LNG', 'LNG Disha', 'LNGC', 93000, 'TC', 18.0, 65000, 0, 12.5, 9.0, [C('T1', 47000), C('T2', 46000)]),
    V('v_lng2', 'LNG', 'LNG Raahi', 'LNGC', 90000, 'OWNED', 17.5, 62000, 0, 12.3, 9.0, [C('T1', 45000), C('T2', 45000)]),
    V('v_lng3', 'LNG', 'LNG Aseem', 'LNGC', 92000, 'COA', 18.0, 63000, 0, 12.5, 9.0, [C('T1', 46000), C('T2', 46000)]),
    V('v_lng_s1', 'LNG', 'Spot LNGC Aegean', 'LNGC', 90000, 'SPOT', 18.0, 0, 30, 12.4, 9.0, [C('T1', 45000), C('T2', 45000)]),
  ];

  // ---- Compartment compatibility (from → to). Unlisted pairs default allowed, 0 cost.
  // Grounded in real transition practice: jet (ATF) is strict (a residual FO/LSHS prior
  // cargo disqualifies the tank → drives the EI/JIG last-cargoes rule); residual → clean
  // needs heavy cleaning; clean grades interchange cheaply; clean → residual is easy.
  // Bitumen segregation is handled by vessel service (BITUMEN), so needs no rows here.
  const CLEAN = ['p1', 'p2', 'p3', 'p4', 'p10', 'p13', 'p14'];
  const compat: Array<[string, string, string, number, number, number]> = [
    // Into ATF (jet) — kerosene family cheap, gasoline/diesel expensive, residual forbidden
    ['POL', 'p4', 'p3', 1, 6, 80000],
    ['POL', 'p1', 'p3', 1, 24, 400000], ['POL', 'p14', 'p3', 1, 24, 400000],
    ['POL', 'p10', 'p3', 1, 18, 300000],
    ['POL', 'p2', 'p3', 1, 24, 450000], ['POL', 'p13', 'p3', 1, 24, 450000],
    ['POL', 'p9', 'p3', 0, 0, 0], ['POL', 'p11', 'p3', 0, 0, 0], // FO / LSHS → ATF forbidden
    // Clean interchange (cheap)
    ['POL', 'p1', 'p2', 1, 6, 60000], ['POL', 'p2', 'p1', 1, 6, 60000],
    ['POL', 'p1', 'p4', 1, 4, 30000], ['POL', 'p4', 'p1', 1, 4, 30000],
    ['POL', 'p2', 'p10', 1, 8, 90000], ['POL', 'p10', 'p2', 1, 8, 90000],
    ['POL', 'p1', 'p14', 1, 2, 15000], ['POL', 'p14', 'p1', 1, 2, 15000], // XtraGreen ≈ HSD
    ['POL', 'p2', 'p13', 1, 2, 15000], ['POL', 'p13', 'p2', 1, 2, 15000], // XtraPremium ≈ MS
    ['POL', 'p3', 'p1', 1, 6, 60000], ['POL', 'p3', 'p2', 1, 6, 60000], ['POL', 'p3', 'p4', 1, 4, 20000],
    // Residual FO / LSHS interchange
    ['POL', 'p9', 'p11', 1, 4, 15000], ['POL', 'p11', 'p9', 1, 4, 15000],
    // Crude grades interchange
    ['CRUDE', 'p5', 'p6', 1, 12, 200000], ['CRUDE', 'p6', 'p5', 1, 12, 200000],
    ['CRUDE', 'p5', 'p7', 1, 10, 160000], ['CRUDE', 'p7', 'p5', 1, 10, 160000],
    ['CRUDE', 'p6', 'p16', 1, 12, 200000], ['CRUDE', 'p16', 'p6', 1, 12, 200000],
  ];
  // Residual → clean (heavy clean) and clean → residual (easy downgrade), generated.
  for (const cl of CLEAN) {
    for (const res of ['p9', 'p11']) {
      compat.push(['POL', res, cl, 1, 18, 250000]);
      compat.push(['POL', cl, res, 1, 4, 20000]);
    }
  }
  const productCompatibility = compat.map(([stream, from, to, allowed, hrs, cost], i) => ({ id: `pc_${i + 1}`, stream, scope: 'COMPARTMENT', fromProduct: from, toProduct: to, allowed, changeoverHours: hrs, changeoverCost: cost }));

  await db.insert(schema.products).values(products);
  await db.insert(schema.locations).values(locations);
  await db.insert(schema.vessels).values(vessels);
  await db.insert(schema.tanks).values(tanks);
  await db.insert(schema.nodeFlows).values(nodeFlows);
  await db.insert(schema.planLines).values(planLines);
  await db.insert(schema.berths).values(berths);
  await db.insert(schema.productCompatibility).values(productCompatibility);
}
