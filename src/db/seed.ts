import * as schema from './schema';

/**
 * IOCL-grounded coastal MIRP network, 30-day start-of-month plan (horizon day 0 = 2026-07-01).
 *
 * Grounded in public facts about Indian Oil (11 refineries ~80.55 MMTPA, ~13,000 km
 * product pipelines, a bunkering network at ~15 ports) and its coastal logistics, then
 * made internally consistent so the solver always has a feasible plan. Grade specs
 * (density/flash/pour/sulphur/rating/parcel bands) are ILLUSTRATIVE planning defaults,
 * anchored to Indian standards where public — not operational IOCL assay sheets.
 *
 * POL: four marine-export refineries — Gujarat/Koyali (13.7 MMTPA, via Sikka), Paradip
 * (15.0, South Oil Jetty 14 m draft), Haldia (8.0, Hooghly, MR-max ~11.5 m) and CPCL
 * Manali/Chennai (10.5) — load fourteen grades to eleven marketing terminals down both
 * coasts. Clean white oils (HSD, MS, ATF, SKO, Naphtha, the branded XP95/XP100 and
 * XtraGreen, LDO, and the LSMGO bunker distillate), BLACK residuals (FO, LSHS, and the
 * VLSFO bunker grade), and heated Bitumen (VG30) never share a hull — three-way
 * segregation by vessel service. Compartment rules encode the jet (ATF) restriction.
 *
 * Fleet uses SCI-style names (Swarna product tankers, Desh crude tankers, the
 * Disha/Raahi/Aseem LNG carriers) at realistic class DWT / draft / tank counts (MR ~12,
 * VLCC ~15, LNGC ~4). A cargo parcel can span several compartments, and one compartment
 * can be part-discharged across destinations, so bulk crude/LNG fills many tanks and
 * coastal drops share tanks. Charter pools: OWNED, TC, COA (Contract of Affreightment),
 * and SPOT (the recommend pool). Port drafts tier the fleet — LR2 (~13 m) is barred from
 * Haldia/Kandla/Mumbai; MRs, Handysize and a small coastal tanker reach everywhere.
 *
 * CRUDE: four import grades (Arab Light, Basrah Heavy, Murban, Urals) on VLCC/Suezmax/
 * Aframax to refinery crude farms (Vadinar 1.5 MMT, Paradip 1.1 MMT, Chennai, Mumbai).
 * LNG: Qatar/Australia to the Dahej, Ennore and Kochi regas terminals.
 */
export async function seed(db: any) {
  const W = { start: '2026-07-01', end: '2026-07-31' };
  const DAYS = 30;
  const C = (id: string, cap: number) => ({ id, cap });
  // n compartments summing to ~0.95·DWT; product tankers use port/starboard pairs.
  const gen = (total: number, n: number, pair: boolean, fill = 0.95) => {
    const each = Math.max(500, Math.round(total * fill / n / 100) * 100);
    return Array.from({ length: n }, (_, i) => C(pair ? `${Math.floor(i / 2) + 1}${i % 2 ? 'S' : 'P'}` : `C${i + 1}`, each));
  };
  // Grade spec block.
  const S = (density: number | null, flash: number | null, pour: number | null, sulphur: string, rating: string, pmin: number, pmax: number) =>
    ({ density, flashPoint: flash, pourPoint: pour, sulphur, rating, parcelMin: pmin, parcelMax: pmax });

  // ---- Products (grades / SKUs with illustrative specs) --------------------
  const products = [
    // POL — CLEAN white oils
    { id: 'p1', stream: 'POL', name: 'HSD', type: 'POL', color: '#f59e0b', cargoClass: 'CLEAN', ...S(835, 35, 3, '10 ppm', '51 CN', 2000, 40000) },
    { id: 'p2', stream: 'POL', name: 'MS', type: 'POL', color: '#ef4444', cargoClass: 'CLEAN', ...S(745, null, null, '10 ppm', '91 RON', 2000, 35000) },
    { id: 'p3', stream: 'POL', name: 'ATF', type: 'POL', color: '#3b82f6', cargoClass: 'CLEAN', ...S(800, 38, -47, 'trace', 'Jet A-1', 1000, 15000) },
    { id: 'p4', stream: 'POL', name: 'SKO', type: 'POL', color: '#8b5cf6', cargoClass: 'CLEAN', ...S(805, 35, -18, 'std', 'SKO', 1000, 12000) },
    { id: 'p10', stream: 'POL', name: 'Naphtha', type: 'POL', color: '#14b8a6', cargoClass: 'CLEAN', ...S(700, null, null, 'low', 'Naphtha', 2000, 30000) },
    { id: 'p13', stream: 'POL', name: 'XP95', type: 'POL', color: '#f97316', cargoClass: 'CLEAN', ...S(748, null, null, '10 ppm', '95 RON', 2000, 20000) },
    { id: 'p15', stream: 'POL', name: 'XP100', type: 'POL', color: '#fb923c', cargoClass: 'CLEAN', ...S(750, null, null, '10 ppm', '100 RON', 1000, 10000) },
    { id: 'p14', stream: 'POL', name: 'XtraGreen', type: 'POL', color: '#22c55e', cargoClass: 'CLEAN', ...S(835, 35, 3, '10 ppm', '55 CN', 2000, 20000) },
    { id: 'p17', stream: 'POL', name: 'LDO', type: 'POL', color: '#eab308', cargoClass: 'CLEAN', ...S(860, 66, 15, 'legacy', 'LDO', 1000, 8000) },
    { id: 'p19', stream: 'POL', name: 'LSMGO', type: 'POL', color: '#06b6d4', cargoClass: 'CLEAN', ...S(860, 60, -6, '0.10%', 'DMA', 1000, 12000) }, // marine gasoil bunker
    // POL — BLACK residuals (dirty tankers only)
    { id: 'p9', stream: 'POL', name: 'FO', type: 'POL', color: '#a8a29e', cargoClass: 'BLACK', ...S(970, 66, 18, '4.0% max', 'FO MV2', 2000, 12000) },
    { id: 'p11', stream: 'POL', name: 'LSHS', type: 'POL', color: '#78716c', cargoClass: 'BLACK', ...S(950, 93, 30, 'low S', 'LSHS', 2000, 12000) },
    { id: 'p18', stream: 'POL', name: 'VLSFO', type: 'POL', color: '#57534e', cargoClass: 'BLACK', ...S(930, 60, 12, '0.50% max', 'RMG380', 1500, 25000) }, // IMO-2020 bunker
    // POL — Bitumen (heated, dedicated carrier only)
    { id: 'p12', stream: 'POL', name: 'Bitumen', type: 'POL', color: '#44403c', cargoClass: 'BITUMEN', ...S(1010, 220, null, '—', 'VG30', 1000, 5000) },
    // CRUDE — import grades
    { id: 'p5', stream: 'CRUDE', name: 'Arab Light', type: 'CRUDE', color: '#10b981', cargoClass: 'CRUDE', ...S(860, 60, -6, '1.8%', '33 API', 65000, 280000) },
    { id: 'p6', stream: 'CRUDE', name: 'Basrah Heavy', type: 'CRUDE', color: '#059669', cargoClass: 'CRUDE', ...S(890, 40, -10, '3.5%', '27 API', 65000, 280000) },
    { id: 'p7', stream: 'CRUDE', name: 'Murban', type: 'CRUDE', color: '#34d399', cargoClass: 'CRUDE', ...S(820, 40, -12, '0.8%', '40 API', 65000, 280000) },
    { id: 'p16', stream: 'CRUDE', name: 'Urals', type: 'CRUDE', color: '#047857', cargoClass: 'CRUDE', ...S(870, 40, -10, '1.5%', '31 API', 65000, 280000) },
    { id: 'p20', stream: 'CRUDE', name: 'Kuwait Export', type: 'CRUDE', color: '#065f46', cargoClass: 'CRUDE', ...S(885, 40, -12, '2.6%', '31 API', 65000, 280000) },
    // LNG
    { id: 'p8', stream: 'LNG', name: 'LNG', type: 'LNG', color: '#ec4899', cargoClass: 'LNG', ...S(450, null, null, '—', 'LNG', 40000, 90000) },
  ];

  // ---- POL refineries (marine loading points). Draft tiers the fleet. -------
  const polRef = [
    { id: 'l_koyali', name: 'Gujarat Refinery (Sikka)', lat: 22.43, lng: 69.84, draft: 14.0, berths: 2, capMMTPA: 13.7, makes: ['p1', 'p2', 'p3', 'p4', 'p10', 'p13', 'p15', 'p14', 'p17', 'p19', 'p9', 'p11', 'p18', 'p12'] },
    { id: 'l_paradip_ref', name: 'Paradip Refinery', lat: 20.27, lng: 86.68, draft: 14.0, berths: 2, capMMTPA: 15.0, makes: ['p1', 'p2', 'p3', 'p4', 'p10', 'p13', 'p15', 'p14', 'p17', 'p19', 'p9', 'p11', 'p18'] },
    { id: 'l_haldia_ref', name: 'Haldia Refinery', lat: 22.03, lng: 88.09, draft: 11.5, berths: 2, capMMTPA: 8.0, makes: ['p1', 'p2', 'p3', 'p4', 'p17', 'p9', 'p11', 'p18', 'p12'] },
    { id: 'l_cpcl', name: 'CPCL Chennai (Manali)', lat: 13.24, lng: 80.32, draft: 15.0, berths: 2, capMMTPA: 10.5, makes: ['p1', 'p2', 'p3', 'p4', 'p17', 'p19', 'p9', 'p11', 'p18', 'p12'] },
  ];

  // ---- POL marketing terminals (daily offtake per grade, MT/day) -----------
  const polTerm = [
    // West coast
    { id: 'l_kandla', name: 'Kandla Terminal', lat: 23.03, lng: 70.22, draft: 12.5, d: { p1: 1900, p2: 1300, p4: 500, p9: 700, p11: 300, p17: 300 } },
    { id: 'l_pipavav', name: 'Pipavav Terminal', lat: 20.92, lng: 71.53, draft: 12.0, d: { p1: 700, p2: 400 } },
    { id: 'l_mumbai', name: 'Mumbai (Pir Pau) Terminal', lat: 18.95, lng: 72.95, draft: 12.0, d: { p1: 2300, p2: 1500, p3: 1000, p13: 400, p15: 150, p14: 400, p10: 600, p19: 250, p18: 400 } },
    { id: 'l_goa', name: 'Goa (Mormugao) Terminal', lat: 15.40, lng: 73.80, draft: 13.0, d: { p1: 900, p2: 600, p3: 400 } },
    { id: 'l_mangalore', name: 'New Mangalore Terminal', lat: 12.94, lng: 74.80, draft: 14.0, d: { p1: 1300, p2: 800, p4: 400, p9: 400, p19: 150, p18: 250 } },
    { id: 'l_kochi', name: 'Kochi Terminal', lat: 9.97, lng: 76.27, draft: 13.0, d: { p1: 1600, p2: 900, p3: 700, p4: 500, p13: 300 } },
    // East / south coast
    { id: 'l_tuticorin', name: 'Tuticorin (V.O.C.) Terminal', lat: 8.76, lng: 78.18, draft: 12.8, d: { p1: 1100, p2: 500, p4: 350 } },
    { id: 'l_ennore', name: 'Ennore (Kamarajar) Terminal', lat: 13.28, lng: 80.35, draft: 13.5, d: { p1: 1800, p2: 1000, p3: 600, p14: 300, p12: 150 } },
    { id: 'l_krishnapatnam', name: 'Krishnapatnam Terminal', lat: 14.28, lng: 80.12, draft: 16.0, d: { p1: 1200, p2: 600, p12: 200 } },
    { id: 'l_kakinada', name: 'Kakinada Terminal', lat: 16.96, lng: 82.25, draft: 12.0, d: { p1: 800, p2: 400, p10: 300 } },
    { id: 'l_vizag', name: 'Visakhapatnam Terminal', lat: 17.69, lng: 83.28, draft: 14.0, d: { p1: 1700, p2: 900, p9: 700, p4: 400, p11: 300, p17: 250, p19: 200, p18: 350 } },
  ];

  const polProdIds = ['p1', 'p2', 'p3', 'p4', 'p10', 'p13', 'p15', 'p14', 'p17', 'p19', 'p9', 'p11', 'p18', 'p12'];
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
    berths.push({ id: `b_${++bb}`, stream: 'POL', locationId: r.id, name: `${tag(r.id)}-JETTY`, nsim: r.berths, rateMtPerHr: 2800, berthingHours: 12, maxDraft: r.draft });
    for (const p of r.makes) {
      const perRef = Math.round(cons[p] / Math.max(1, makesOf[p].length));
      tanks.push({ id: `t_${++tk}`, stream: 'POL', locationId: r.id, productId: p, capacity: 1200000, minStock: 20000, currentStock: 300000, name: `${tag(r.id)}-${p}` });
      nodeFlows.push({ id: `nf_${++nf}`, stream: 'POL', locationId: r.id, productId: p, dailyIn: perRef, dailyOut: 0 });
      if (perRef > 0) planLines.push({ id: `pl_${++pl}`, stream: 'POL', kind: 'SUPPLY', productId: p, locationId: r.id, qty: perRef * DAYS, windowStart: W.start, windowEnd: W.end, priority: 2 });
    }
  }
  for (const t of polTerm) {
    locations.push({ id: t.id, stream: 'POL', name: t.name, type: 'COASTAL_TERMINAL', lat: t.lat, lng: t.lng });
    berths.push({ id: `b_${++bb}`, stream: 'POL', locationId: t.id, name: `${tag(t.id)}-BERTH`, nsim: 1, rateMtPerHr: 1800, berthingHours: 12, maxDraft: t.draft });
    for (const [p, q0] of Object.entries(t.d)) {
      const q = q0 as number;
      // Bitumen moves in seasonal campaigns on a single dedicated carrier: horizon-sized heated storage.
      const big = p === 'p12';
      tanks.push({ id: `t_${++tk}`, stream: 'POL', locationId: t.id, productId: p, capacity: q * (big ? 80 : 45), minStock: q * 2, currentStock: q * (big ? 38 : 20), name: `${tag(t.id)}-${p}` });
      nodeFlows.push({ id: `nf_${++nf}`, stream: 'POL', locationId: t.id, productId: p, dailyIn: 0, dailyOut: q });
      planLines.push({ id: `pl_${++pl}`, stream: 'POL', kind: 'DEMAND', productId: p, locationId: t.id, qty: q * DAYS, windowStart: W.start, windowEnd: W.end, priority: q >= 1500 ? 1 : 2 });
    }
  }

  // ---- CRUDE (seaborne imports → coastal refinery intake gateways) ----------
  // Crude is imported directly at coastal SPM/SBM/port gateways; inland refineries are
  // fed onward by pipeline (Salaya–Mathura → Koyali/Mathura; Mundra–Panipat; Paradip–
  // Haldia–Barauni), modeled here as crude consumption at the gateway. The source slate
  // reflects FY24-25 reality — Russia (Urals) + the Persian Gulf dominate (~77% of imports);
  // US Gulf / W.Africa spot volumes are minor and largely delivered-basis, so are not
  // modeled as IOCL-scheduled tonnage. Intake rates ≈ refinery throughput (MMTPA·1e6/365).
  const crudeSrc: any[] = [
    ['l_ras_tanura', 'Ras Tanura (Saudi Aramco)', 26.65, 50.15, 'p5'],       // Arab Light — Gulf
    ['l_basrah', 'Basrah Oil Terminal (Iraq)', 29.68, 48.80, 'p6'],          // Basrah Heavy — Gulf
    ['l_kuwait', 'Mina al-Ahmadi (Kuwait)', 29.07, 48.13, 'p20'],            // Kuwait Export — Gulf
    ['l_das_crude', 'Das Island (ADNOC, UAE)', 25.14, 52.87, 'p7'],          // Murban — Gulf
    ['l_novorossiysk', 'Novorossiysk (Urals, Russia)', 44.72, 37.79, 'p16'], // Urals — Black Sea
  ];
  // Gateway → refineries fed (onward by pipeline), grade, intake t/day, opening stock (t), and
  // tank-farm capacity (t) set to IOCL's published figures: Vadinar 1.5 MMT (18 tanks), Mundra
  // 0.6 MMT (12), Paradip 1.1 MMT (20), Haldia LBT 0.4 MMT (8). Vadinar is the dominant west
  // gateway — the 2,663 km Salaya–Mathura line (25 MMTPA) feeds Koyali + Mathura + most of
  // Panipat; Mundra is the small MPPL secondary (8.4 MMTPA); Paradip's three SPMs feed the east
  // via the 1,465 km PHBPL. Haldia is draft-limited (~14 m) → Aframax; Chennai (CPCL) → Suezmax.
  // Grades map to IOCL's real top suppliers (Saudi/Iraq/Kuwait/UAE Gulf + Russia, ~Russia 36% of
  // the FY24 national basket). The slow Russia (Urals) lane is placed on low-drain Mundra so one
  // in-horizon cargo covers it; the Gulf lanes (5–10 d) carry the rest. Tanks start ~90% full,
  // as real refineries build crude inventory before the operating month. Volumes are scaled for a
  // solvable from-empty 30-day demo but preserve the real gateway proportions (Vadinar >> Mundra).
  const crudeIntake: any[] = [
    // id, name, lat, lng, grade, t/day, opening(t), tankCap(t), berth draft
    ['l_vadinar', 'Vadinar SPM (→ Koyali/Mathura/Panipat)', 22.28, 69.73, 'p5', 60000, 1350000, 1500000, 32],
    ['l_mundra', 'Mundra SBM (→ Panipat)', 22.74, 69.70, 'p16', 15000, 550000, 600000, 32],
    ['l_paradip_crude', 'Paradip SPM (→ Paradip refinery)', 20.26, 86.67, 'p6', 45000, 1050000, 1100000, 32],
    ['l_haldia_crude', 'Haldia Oil Jetties (→ Haldia)', 22.03, 88.09, 'p20', 14000, 420000, 500000, 14],
    ['l_chennai_crude', 'Chennai Port (→ CPCL Manali)', 13.10, 80.30, 'p7', 28000, 560000, 620000, 17],
  ];
  for (const [id, name, lat, lng, grade] of crudeSrc) {
    locations.push({ id, stream: 'CRUDE', name, type: 'SOURCE', lat, lng });
    tanks.push({ id: `t_${++tk}`, stream: 'CRUDE', locationId: id, productId: grade, capacity: 6000000, minStock: 0, currentStock: 2500000, name: `${tag(id)}-CR` });
    nodeFlows.push({ id: `nf_${++nf}`, stream: 'CRUDE', locationId: id, productId: grade, dailyIn: 90000, dailyOut: 0 });
    berths.push({ id: `b_${++bb}`, stream: 'CRUDE', locationId: id, name: `${tag(id)}-SPM`, nsim: 2, rateMtPerHr: 9000, berthingHours: 24, maxDraft: 32 });
  }
  for (const [id, name, lat, lng, grade, dout, open, cap, draft] of crudeIntake) {
    const q = dout as number;
    locations.push({ id, stream: 'CRUDE', name, type: 'CRUDE_INTAKE', lat, lng });
    tanks.push({ id: `t_${++tk}`, stream: 'CRUDE', locationId: id, productId: grade, capacity: cap as number, minStock: q * 4, currentStock: open as number, name: `${tag(id)}-CR` });
    nodeFlows.push({ id: `nf_${++nf}`, stream: 'CRUDE', locationId: id, productId: grade, dailyIn: 0, dailyOut: q });
    planLines.push({ id: `pl_${++pl}`, stream: 'CRUDE', kind: 'DEMAND', productId: grade, locationId: id, qty: q * DAYS, windowStart: W.start, windowEnd: W.end, priority: 1 });
    berths.push({ id: `b_${++bb}`, stream: 'CRUDE', locationId: id, name: `${tag(id)}-BERTH`, nsim: 1, rateMtPerHr: 9000, berthingHours: 24, maxDraft: draft as number });
  }

  // ---- LNG (foreign liquefaction ports → IOCL regas terminals) --------------
  // LNG is not refined: it lands at coastal regas terminals, is stored cryogenically, vaporized
  // and sent out by pipeline to power / city-gas / fertilizer demand. IOCL's ~13.18 MMTPA regas
  // portfolio: its OWNED Ennore (Kamarajar) terminal (5 MMTPA, 2×180,000 m³ tanks, berth 362 m
  // LOA / 12.5 m draft), plus booked capacity at Dahej (3.75), Dhamra (3.0), Jafrabad (1.0) and
  // Kochi (0.43). Dahej + Dhamra carry the west/east baseload; Ennore is growing (~24% utilised);
  // Kochi is pipeline-constrained and light. Sources: Ras Laffan (Qatar, ~3-day workhorse), Das
  // Island (ADNOC/UAE) and Qalhat (Oman) short-haul, US Gulf the long-haul swing (Trafigura deal).
  const lngSrc: any[] = [
    ['l_ras_laffan', 'Ras Laffan (Qatar)', 25.91, 51.55],
    ['l_das_lng', 'Das Island (ADNOC, UAE)', 25.14, 52.87],
    ['l_qalhat', 'Qalhat (Oman LNG)', 22.60, 59.45],
    ['l_sabine', 'Sabine Pass (US Gulf)', 29.73, -93.87],
  ];
  // id, name, lat, lng, send-out t/day, berth draft, storage cap (t), opening (t), floor (t)
  const lngTerm: any[] = [
    ['l_dahej', 'Dahej LNG Terminal (IOCL 3.75 MMTPA booked)', 21.68, 72.53, 7700, 13.0, 190000, 150000, 25000],
    ['l_dhamra', 'Dhamra LNG Terminal (IOCL 3 MMTPA booked)', 20.79, 87.05, 4800, 14.0, 165000, 130000, 20000],
    ['l_ennore_lng', 'Ennore (Kamarajar) LNG Terminal (owned)', 13.24, 80.34, 4700, 12.5, 162000, 120000, 20000],
    ['l_kochi_lng', 'Kochi (Puthuvype) LNG Terminal', 9.98, 76.24, 1000, 13.0, 155000, 100000, 18000],
  ];
  for (const [id, name, lat, lng] of lngSrc) {
    locations.push({ id, stream: 'LNG', name, type: 'SOURCE', lat, lng });
    tanks.push({ id: `t_${++tk}`, stream: 'LNG', locationId: id, productId: 'p8', capacity: 3000000, minStock: 0, currentStock: 1800000, name: `${tag(id)}-LNG` });
    nodeFlows.push({ id: `nf_${++nf}`, stream: 'LNG', locationId: id, productId: 'p8', dailyIn: 20000, dailyOut: 0 });
    berths.push({ id: `b_${++bb}`, stream: 'LNG', locationId: id, name: `${tag(id)}-JETTY`, nsim: 2, rateMtPerHr: 6000, berthingHours: 18, maxDraft: 14 });
  }
  for (const [id, name, lat, lng, dout, draft, cap, open, mn] of lngTerm) {
    locations.push({ id, stream: 'LNG', name, type: 'LNG_TERMINAL', lat, lng });
    tanks.push({ id: `t_${++tk}`, stream: 'LNG', locationId: id, productId: 'p8', capacity: cap as number, minStock: mn as number, currentStock: open as number, name: `${tag(id)}-LNG` });
    nodeFlows.push({ id: `nf_${++nf}`, stream: 'LNG', locationId: id, productId: 'p8', dailyIn: 0, dailyOut: dout as number });
    planLines.push({ id: `pl_${++pl}`, stream: 'LNG', kind: 'DEMAND', productId: 'p8', locationId: id, qty: (dout as number) * DAYS, windowStart: W.start, windowEnd: W.end, priority: 1 });
    berths.push({ id: `b_${++bb}`, stream: 'LNG', locationId: id, name: `${tag(id)}-JETTY`, nsim: 1, rateMtPerHr: 6000, berthingHours: 18, maxDraft: draft as number });
  }

  // ---- Fleets — SCI-style names, realistic class DWT / draft / segregations --
  // Charter pools: OWNED (IOCL/SCI hulls), TC (whole-ship time charter), COA (Contract of
  // Affreightment — committed volume tonnage), SPOT (single-voyage charter, the recommend pool).
  const V = (id: string, stream: string, name: string, cls: string, dwt: number, pool: string, speed: number, hire: number, voy: number, dl: number, db: number, comps: any[], service?: string) =>
    ({ id, stream, name, class: cls, dwt, charterType: pool === 'SPOT' ? 'VOYAGE' : pool === 'COA' ? 'COA' : 'TC', pool, service: service ?? (stream === 'POL' ? 'CLEAN' : stream), speed, charterCost: hire, voyageRate: voy, availFrom: null, availTo: null, draftLaden: dl, draftBallast: db, compartments: comps });
  const vessels = [
    // POL CLEAN product tankers — Swarna series (owned / TC / COA)
    V('v_pol1', 'POL', 'MT Swarna Godavari', 'MR', 46000, 'OWNED', 13.0, 15500, 0, 11.0, 6.5, gen(46000, 12, true)),
    V('v_pol2', 'POL', 'MT Swarna Kaveri', 'MR', 46000, 'COA', 13.0, 14500, 0, 11.0, 6.5, gen(46000, 12, true)),
    V('v_pol3', 'POL', 'MT Swarna Pushp', 'Handysize', 37000, 'OWNED', 12.0, 12000, 0, 10.2, 6.0, gen(37000, 10, true)),
    V('v_pol4', 'POL', 'MT Swarna Sindhu', 'LR1', 74000, 'TC', 14.0, 22000, 0, 12.2, 7.0, gen(74000, 12, true)),
    V('v_pol5', 'POL', 'MT Swarna Krishna', 'LR1', 73000, 'OWNED', 14.0, 21000, 0, 12.2, 7.0, gen(73000, 12, true)),
    V('v_pol6', 'POL', 'MT Swarna Jayanti', 'LR2', 110000, 'TC', 14.5, 30000, 0, 13.0, 7.5, gen(110000, 12, true)),
    V('v_pol7', 'POL', 'MT Swarna Mala', 'MR', 48000, 'COA', 13.2, 15500, 0, 11.1, 6.6, gen(48000, 12, true)),
    // POL small coastal product tanker — short intra-coast trades
    V('v_pol_c1', 'POL', 'MT Coastal Sindhu', 'Coastal Tanker', 11000, 'OWNED', 11.5, 8500, 0, 7.4, 4.4, gen(11000, 8, true)),
    // POL CLEAN spot pool
    V('v_pol_s1', 'POL', 'Spot MR Alpha', 'MR', 46000, 'SPOT', 13.0, 0, 14, 11.0, 6.5, gen(46000, 12, true)),
    V('v_pol_s2', 'POL', 'Spot LR1 Bravo', 'LR1', 73000, 'SPOT', 14.0, 0, 12, 12.3, 7.0, gen(73000, 12, true)),
    V('v_pol_s3', 'POL', 'Spot MR Charlie', 'MR', 45000, 'SPOT', 13.0, 0, 15, 11.0, 6.5, gen(45000, 12, true)),
    V('v_pol_s4', 'POL', 'Spot Handy Delta', 'Handysize', 35000, 'SPOT', 12.5, 0, 16, 10.0, 5.8, gen(35000, 10, true)),
    V('v_pol_s5', 'POL', 'Spot LR2 Foxtrot', 'LR2', 112000, 'SPOT', 14.5, 0, 10, 13.1, 7.6, gen(112000, 12, true)),
    // POL BLACK residual (FO / LSHS / VLSFO) tankers — never mixed with clean product
    V('v_pol_fo1', 'POL', 'MT Jag Pratap', 'MR', 45000, 'OWNED', 12.5, 13500, 0, 11.0, 6.5, gen(45000, 4, false), 'BLACK'),
    V('v_pol_fo2', 'POL', 'MT Maharshi Karve', 'MR', 46000, 'TC', 12.5, 13800, 0, 11.0, 6.5, gen(46000, 4, false), 'BLACK'),
    V('v_pol_fo3', 'POL', 'Spot Dirty Echo', 'MR', 46000, 'SPOT', 12.5, 0, 13, 11.0, 6.5, gen(46000, 4, false), 'BLACK'),
    // POL Bitumen — dedicated heated carrier (never mixed with anything); spot pool for peaks
    V('v_pol_bit', 'POL', 'MT Asphalt Pioneer', 'Bitumen Carrier', 12000, 'OWNED', 11.5, 9000, 0, 7.5, 4.5, [C('1', 3000), C('2', 3000), C('3', 3000), C('4', 3000)], 'BITUMEN'),
    V('v_pol_bit_s', 'POL', 'Spot Bitumen Trader', 'Bitumen Carrier', 11000, 'SPOT', 11.5, 0, 22, 7.3, 4.4, [C('1', 3000), C('2', 3000), C('3', 3000)], 'BITUMEN'),
    // CRUDE — Desh series: SCI-operated Suezmaxes (owned) + time-charter VLCCs for the Gulf
    // program + COA hulls for Urals/east-coast liftings + a spot pool. Aframaxes (laden < 14 m)
    // are the only class that can berth draft-limited Haldia; VLCCs only call deep-water SPMs.
    V('v_cru1', 'CRUDE', 'MT Desh Shakti', 'Suezmax', 158000, 'OWNED', 14.0, 28000, 0, 16.0, 9.0, gen(158000, 12, false)),
    V('v_cru2', 'CRUDE', 'MT Desh Gaurav', 'Suezmax', 157000, 'OWNED', 14.0, 27000, 0, 15.9, 9.0, gen(157000, 12, false)),
    V('v_cru3', 'CRUDE', 'MT Desh Ujaala', 'VLCC', 311000, 'TC', 15.0, 35000, 0, 20.5, 10.0, gen(311000, 15, false)),
    V('v_cru4', 'CRUDE', 'MT Desh Bhakti', 'VLCC', 300000, 'TC', 15.0, 34000, 0, 20.2, 10.0, gen(300000, 15, false)),
    V('v_cru5', 'CRUDE', 'MT Desh Rakshak', 'VLCC', 316000, 'TC', 15.0, 35500, 0, 20.6, 10.0, gen(316000, 15, false)),
    V('v_cru6', 'CRUDE', 'MT Desh Vaibhav', 'Aframax', 110000, 'COA', 13.5, 21500, 0, 13.8, 8.0, gen(110000, 12, false)),
    V('v_cru7', 'CRUDE', 'MT Desh Prem', 'Suezmax', 150000, 'COA', 14.0, 26000, 0, 15.8, 9.0, gen(150000, 12, false)),
    // CRUDE spot pool (the recommendation pool)
    V('v_cru_s1', 'CRUDE', 'Spot VLCC Ceres', 'VLCC', 311000, 'SPOT', 15.0, 0, 8, 20.5, 10.0, gen(311000, 15, false)),
    V('v_cru_s2', 'CRUDE', 'Spot Suezmax Nord', 'Suezmax', 158000, 'SPOT', 14.0, 0, 9, 16.2, 9.0, gen(158000, 12, false)),
    V('v_cru_s3', 'CRUDE', 'Spot Aframax Baltic', 'Aframax', 105000, 'SPOT', 13.5, 0, 11, 13.6, 8.0, gen(105000, 12, false)),
    // LNG — Disha (Q-Flex) / Raahi / Aseem (conventional) + spot; short Qatar/UAE hauls
    V('v_lng1', 'LNG', 'LNG Disha', 'LNGC', 93000, 'TC', 18.5, 65000, 0, 12.0, 9.0, gen(93000, 4, false, 1.0)),
    V('v_lng2', 'LNG', 'LNG Raahi', 'LNGC', 75000, 'OWNED', 18.5, 58000, 0, 11.7, 9.0, gen(75000, 4, false, 1.0)),
    V('v_lng3', 'LNG', 'LNG Aseem', 'LNGC', 74000, 'COA', 18.5, 57000, 0, 11.7, 9.0, gen(74000, 4, false, 1.0)),
    V('v_lng_s1', 'LNG', 'Spot LNGC Aegean', 'LNGC', 90000, 'SPOT', 18.5, 0, 30, 11.9, 9.0, gen(90000, 4, false, 1.0)),
  ];

  // ---- Compartment compatibility (from → to). Unlisted pairs default allowed, 0 cost.
  // Three-way service segregation (CLEAN / BLACK / BITUMEN) already keeps residuals and
  // bitumen off clean tankers, so the meaningful rows are the jet (ATF) transitions: a
  // residual prior cargo disqualifies the tank (EI/JIG last-cargoes rule), kerosene is
  // cheap into jet, gasoline/diesel expensive. Crude grades interchange with a clean.
  const compat: Array<[string, string, string, number, number, number]> = [
    ['POL', 'p4', 'p3', 1, 6, 80000],
    ['POL', 'p1', 'p3', 1, 24, 400000], ['POL', 'p14', 'p3', 1, 24, 400000],
    ['POL', 'p10', 'p3', 1, 18, 300000],
    ['POL', 'p2', 'p3', 1, 24, 450000], ['POL', 'p13', 'p3', 1, 24, 450000], ['POL', 'p15', 'p3', 1, 24, 450000],
    ['POL', 'p9', 'p3', 0, 0, 0], ['POL', 'p11', 'p3', 0, 0, 0], ['POL', 'p18', 'p3', 0, 0, 0], // residual → ATF forbidden
    ['CRUDE', 'p5', 'p6', 1, 12, 200000], ['CRUDE', 'p6', 'p5', 1, 12, 200000],
    ['CRUDE', 'p5', 'p7', 1, 10, 160000], ['CRUDE', 'p7', 'p5', 1, 10, 160000],
    ['CRUDE', 'p6', 'p16', 1, 12, 200000], ['CRUDE', 'p16', 'p6', 1, 12, 200000],
  ];
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
