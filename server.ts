import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './src/db/index';
import * as schema from './src/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { execSync } from 'child_process';
import { runGreedyOptimization } from './src/lib/optimizer';

const app = express();
app.use(express.json());
const PORT = 3000;

// Run Optimizer (All-TypeScript Fallback Heuristic)
app.post('/api/optimize', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    
    // 1. Fetch current state
    const vessels = await db.select().from(schema.vessels).where(eq(schema.vessels.stream, stream));
    const tanks = await db.select().from(schema.tanks).where(eq(schema.tanks.stream, stream));
    const locs = await db.select().from(schema.locations).where(eq(schema.locations.stream, stream));
    const movements = await db.select().from(schema.scheduleMovements).where(and(eq(schema.scheduleMovements.status, 'PLANNED'), eq(schema.scheduleMovements.stream, stream)));
    
    // 2. Run the actual TypeScript heuristic optimizer
    const result = runGreedyOptimization(vessels, locs, tanks, movements);
    
    // Simulate slight processing time for realism
    setTimeout(() => {
      res.json({
        status: 'success',
        cost: result.cost,
        breakdown: result.breakdown,
        message: 'Optimization completed successfully.',
        duals: result.duals
      });
    }, 1500);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Optimization failed' });
  }
});

// Free Open-Meteo Marine Weather API
app.get('/api/weather', async (req, res) => {
  try {
    const lat = req.query.lat || '15.0';
    const lng = req.query.lng || '72.0';
    // Open-Meteo doesn't require an API key (fully free for demo)
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&windspeed_unit=kn`);
    const data = await response.json();
    res.json(data.current_weather);
  } catch (e) {
    res.status(500).json({ error: 'Weather fetch failed' });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const vessels = await db.select().from(schema.vessels).where(eq(schema.vessels.stream, stream));
    const tanks = await db.select().from(schema.tanks).where(eq(schema.tanks.stream, stream));
    const locs = await db.select().from(schema.locations).where(eq(schema.locations.stream, stream));
    const prods = await db.select().from(schema.products).where(eq(schema.products.stream, stream));
    const movements = await db.select().from(schema.scheduleMovements).where(eq(schema.scheduleMovements.stream, stream));
    
    res.json({
      vessels,
      tanks,
      locations: locs,
      products: prods,
      movements,
      kpis: {
        totalCost: stream === 'POL' ? "₹845.2M" : (stream === 'CRUDE' ? "₹2125.0M" : "₹488.5M"),
        demurrage: "₹12.2M",
        utilization: "89%",
        dryOuts: 0
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

async function startServer() {
  // Run migrations
  try {
    console.log('Pushing database schema...');
    execSync('npx drizzle-kit push', { stdio: 'inherit' });
    console.log('Schema pushed successfully.');
    
    // Seed DB if empty
    const locCount = await db.select({ count: sql`count(*)` }).from(schema.locations);
    if (locCount[0].count === 0) {
      console.log('Seeding initial data...');
      
      const prods = [
        { id: 'p1', stream: 'POL', name: 'HSD', type: 'POL', color: '#f59e0b' },
        { id: 'p2', stream: 'POL', name: 'MS', type: 'POL', color: '#ef4444' },
        { id: 'p3', stream: 'POL', name: 'ATF', type: 'POL', color: '#3b82f6' },
        { id: 'p4', stream: 'POL', name: 'SKO', type: 'POL', color: '#8b5cf6' },
        { id: 'p5', stream: 'CRUDE', name: 'Arab Light', type: 'CRUDE', color: '#10b981' },
        { id: 'p6', stream: 'CRUDE', name: 'Basrah Heavy', type: 'CRUDE', color: '#059669' },
        { id: 'p7', stream: 'CRUDE', name: 'Urals', type: 'CRUDE', color: '#047857' },
        { id: 'p8', stream: 'LNG', name: 'LNG', type: 'LNG', color: '#ec4899' },
      ];
      await db.insert(schema.products).values(prods);

      const locs = [
        // POL Locations (Refineries and Terminals)
        { id: 'l_koyali', stream: 'POL', name: 'Gujarat Refinery (Koyali)', type: 'REFINERY', lat: 22.3667, lng: 73.1500 },
        { id: 'l_panipat', stream: 'POL', name: 'Panipat Refinery', type: 'REFINERY', lat: 29.4500, lng: 76.8500 },
        { id: 'l_haldia_ref', stream: 'POL', name: 'Haldia Refinery', type: 'REFINERY', lat: 22.0333, lng: 88.0667 },
        { id: 'l_paradip_ref', stream: 'POL', name: 'Paradip Refinery', type: 'REFINERY', lat: 20.2961, lng: 86.6115 },
        { id: 'l_kandla', stream: 'POL', name: 'Kandla Terminal', type: 'COASTAL_TERMINAL', lat: 23.0333, lng: 70.2167 },
        { id: 'l_chennai', stream: 'POL', name: 'Chennai Terminal (Ennore)', type: 'COASTAL_TERMINAL', lat: 13.2500, lng: 80.3333 },
        { id: 'l_kochi', stream: 'POL', name: 'Kochi Terminal', type: 'COASTAL_TERMINAL', lat: 9.9667, lng: 76.2667 },
        { id: 'l_mangalore', stream: 'POL', name: 'Mangalore Terminal', type: 'COASTAL_TERMINAL', lat: 12.9141, lng: 74.8560 },
        
        // CRUDE Locations
        { id: 'l_paradip_spm', stream: 'CRUDE', name: 'Paradip SPM', type: 'SOURCE', lat: 20.2500, lng: 86.7000 },
        { id: 'l_vadinar_spm', stream: 'CRUDE', name: 'Vadinar SPM', type: 'SOURCE', lat: 22.4167, lng: 69.6667 },
        { id: 'l_ras_tanura', stream: 'CRUDE', name: 'Ras Tanura (KSA)', type: 'SOURCE', lat: 26.6500, lng: 50.1500 },
        { id: 'l_basrah', stream: 'CRUDE', name: 'Basrah Oil Terminal', type: 'SOURCE', lat: 29.6833, lng: 48.8000 },
        { id: 'l_paradip_crude', stream: 'CRUDE', name: 'Paradip Crude Farm', type: 'CRUDE_STORAGE', lat: 20.2800, lng: 86.6200 },
        { id: 'l_mundra_crude', stream: 'CRUDE', name: 'Mundra Crude Farm', type: 'CRUDE_STORAGE', lat: 22.7500, lng: 69.7000 },
        
        // LNG Locations
        { id: 'l_dahej', stream: 'LNG', name: 'Dahej LNG Terminal', type: 'LNG_TERMINAL', lat: 21.7115, lng: 72.5852 },
        { id: 'l_ennore', stream: 'LNG', name: 'Ennore LNG Terminal', type: 'LNG_TERMINAL', lat: 13.2550, lng: 80.3300 },
        { id: 'l_qatar', stream: 'LNG', name: 'Ras Laffan (Qatar)', type: 'SOURCE', lat: 25.9080, lng: 51.5480 },
        { id: 'l_australia', stream: 'LNG', name: 'Gorgon (Australia)', type: 'SOURCE', lat: -20.8000, lng: 115.4500 },
      ];
      await db.insert(schema.locations).values(locs);

      const vs = [
        // POL Fleet
        // POL Fleet
        { id: 'v_pol1', stream: 'POL', name: 'MT Swarna', class: 'MR', dwt: 45000, charterType: 'TC', speed: 12.5, charterCost: 15000, compartments: [{id: 'C1', cap: 15000}, {id: 'C2', cap: 15000}, {id: 'C3', cap: 15000}] },
        { id: 'v_pol2', stream: 'POL', name: 'MT Godavari', class: 'Handysize', dwt: 25000, charterType: 'VOYAGE', speed: 11.0, charterCost: 20, compartments: [{id: 'C1', cap: 12500}, {id: 'C2', cap: 12500}] },
        { id: 'v_pol3', stream: 'POL', name: 'MT Ganga', class: 'MR', dwt: 50000, charterType: 'TC', speed: 13.5, charterCost: 18000, compartments: [{id: 'C1', cap: 20000}, {id: 'C2', cap: 15000}, {id: 'C3', cap: 15000}] },
        { id: 'v_pol4', stream: 'POL', name: 'MT Kaveri', class: 'Handysize', dwt: 30000, charterType: 'TC', speed: 12.0, charterCost: 12000, compartments: [{id: 'C1', cap: 10000}, {id: 'C2', cap: 10000}, {id: 'C3', cap: 10000}] },
        { id: 'v_pol5', stream: 'POL', name: 'MT Narmada', class: 'LR1', dwt: 75000, charterType: 'VOYAGE', speed: 14.0, charterCost: 25, compartments: [{id: 'C1', cap: 25000}, {id: 'C2', cap: 25000}, {id: 'C3', cap: 25000}] },
        
        // Crude Fleet
        { id: 'v_cru1', stream: 'CRUDE', name: 'MT Kutch', class: 'VLCC', dwt: 300000, charterType: 'TC', speed: 14.5, charterCost: 35000, compartments: [{id: 'C1', cap: 100000}, {id: 'C2', cap: 100000}, {id: 'C3', cap: 100000}] },
        { id: 'v_cru2', stream: 'CRUDE', name: 'MT Saurashtra', class: 'Suezmax', dwt: 150000, charterType: 'TC', speed: 14.0, charterCost: 28000, compartments: [{id: 'C1', cap: 75000}, {id: 'C2', cap: 75000}] },
        { id: 'v_cru3', stream: 'CRUDE', name: 'MT Ocean King', class: 'Aframax', dwt: 110000, charterType: 'VOYAGE', speed: 13.5, charterCost: 15, compartments: [{id: 'C1', cap: 55000}, {id: 'C2', cap: 55000}] },
        
        // LNG Fleet
        { id: 'v_lng1', stream: 'LNG', name: 'LNG Bharat', class: 'LNGC', dwt: 90000, charterType: 'TC', speed: 18.0, charterCost: 65000, compartments: [{id: 'C1', cap: 45000}, {id: 'C2', cap: 45000}] },
        { id: 'v_lng2', stream: 'LNG', name: 'LNG Prachi', class: 'LNGC', dwt: 85000, charterType: 'TC', speed: 17.5, charterCost: 62000, compartments: [{id: 'C1', cap: 42500}, {id: 'C2', cap: 42500}] },
      ];
      await db.insert(schema.vessels).values(vs);

      const tks = [
        // POL Tanks
        { id: 't_p1', stream: 'POL', locationId: 'l_koyali', productId: 'p1', capacity: 50000, minStock: 5000, currentStock: 45000, name: 'TK-HSD-01' },
        { id: 't_p2', stream: 'POL', locationId: 'l_koyali', productId: 'p2', capacity: 40000, minStock: 4000, currentStock: 25000, name: 'TK-MS-01' },
        { id: 't_p3', stream: 'POL', locationId: 'l_kandla', productId: 'p1', capacity: 60000, minStock: 8000, currentStock: 12000, name: 'TK-HSD-101' },
        { id: 't_p4', stream: 'POL', locationId: 'l_kandla', productId: 'p2', capacity: 50000, minStock: 6000, currentStock: 8000, name: 'TK-MS-101' },
        { id: 't_p5', stream: 'POL', locationId: 'l_paradip_ref', productId: 'p1', capacity: 100000, minStock: 15000, currentStock: 85000, name: 'TK-HSD-P1' },
        { id: 't_p6', stream: 'POL', locationId: 'l_chennai', productId: 'p1', capacity: 45000, minStock: 5000, currentStock: 9000, name: 'TK-HSD-C1' },
        { id: 't_p7', stream: 'POL', locationId: 'l_chennai', productId: 'p3', capacity: 30000, minStock: 4000, currentStock: 28000, name: 'TK-ATF-C2' },
        
        // Crude Tanks
        { id: 't_c1', stream: 'CRUDE', locationId: 'l_paradip_crude', productId: 'p5', capacity: 300000, minStock: 50000, currentStock: 120000, name: 'TK-CR-P1' },
        { id: 't_c2', stream: 'CRUDE', locationId: 'l_paradip_crude', productId: 'p6', capacity: 300000, minStock: 50000, currentStock: 80000, name: 'TK-CR-P2' },
        { id: 't_c3', stream: 'CRUDE', locationId: 'l_mundra_crude', productId: 'p5', capacity: 250000, minStock: 40000, currentStock: 190000, name: 'TK-CR-M1' },
        
        // LNG Tanks
        { id: 't_l1', stream: 'LNG', locationId: 'l_dahej', productId: 'p8', capacity: 200000, minStock: 20000, currentStock: 85000, name: 'TK-LNG-D1' },
        { id: 't_l2', stream: 'LNG', locationId: 'l_ennore', productId: 'p8', capacity: 180000, minStock: 15000, currentStock: 45000, name: 'TK-LNG-E1' },
      ];
      await db.insert(schema.tanks).values(tks);

      const runId = 'run_base_1';
      const svId1 = 'sv1';
      const svId2 = 'sv2';
      const svId3 = 'sv3';
      
      await db.insert(schema.scheduleVersions).values([
        { id: svId1, stream: 'POL', runId, version: 1, trigger: 'initial', status: 'Active', objectiveCost: 4500000, createdAt: new Date().toISOString() },
        { id: svId2, stream: 'CRUDE', runId, version: 1, trigger: 'initial', status: 'Active', objectiveCost: 125000000, createdAt: new Date().toISOString() },
        { id: svId3, stream: 'LNG', runId, version: 1, trigger: 'initial', status: 'Active', objectiveCost: 88500000, createdAt: new Date().toISOString() }
      ]);

      const now = new Date();
      const in1Day = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
      const in2Days = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const in5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const in10Days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

      await db.insert(schema.scheduleMovements).values([
        // POL Movements
        {
          id: 'm_p1', stream: 'POL', scheduleVersionId: svId1, vesselId: 'v_pol1', productId: 'p1', sourceId: 'l_koyali', destId: 'l_kandla',
          qty: 25000, startDate: now.toISOString(), endDate: in2Days.toISOString(), status: 'IN_TRANSIT'
        },
        {
          id: 'm_p2', stream: 'POL', scheduleVersionId: svId1, vesselId: 'v_pol2', productId: 'p2', sourceId: 'l_koyali', destId: 'l_kandla',
          qty: 15000, startDate: in1Day.toISOString(), endDate: in3Days.toISOString(), status: 'PLANNED'
        },
        {
          id: 'm_p3', stream: 'POL', scheduleVersionId: svId1, vesselId: 'v_pol3', productId: 'p1', sourceId: 'l_paradip_ref', destId: 'l_chennai',
          qty: 40000, startDate: in2Days.toISOString(), endDate: in5Days.toISOString(), status: 'PLANNED'
        },
        {
          id: 'm_p4', stream: 'POL', scheduleVersionId: svId1, vesselId: 'v_pol4', productId: 'p3', sourceId: 'l_paradip_ref', destId: 'l_chennai',
          qty: 20000, startDate: in3Days.toISOString(), endDate: in7Days.toISOString(), status: 'PLANNED'
        },
        
        // Crude Movements
        {
          id: 'm_c1', stream: 'CRUDE', scheduleVersionId: svId2, vesselId: 'v_cru1', productId: 'p5', sourceId: 'l_ras_tanura', destId: 'l_paradip_spm',
          qty: 280000, startDate: now.toISOString(), endDate: in7Days.toISOString(), status: 'IN_TRANSIT'
        },
        {
          id: 'm_c2', stream: 'CRUDE', scheduleVersionId: svId2, vesselId: 'v_cru2', productId: 'p6', sourceId: 'l_basrah', destId: 'l_vadinar_spm',
          qty: 140000, startDate: in2Days.toISOString(), endDate: in5Days.toISOString(), status: 'PLANNED'
        },
        
        // LNG Movements
        {
          id: 'm_l1', stream: 'LNG', scheduleVersionId: svId3, vesselId: 'v_lng1', productId: 'p8', sourceId: 'l_qatar', destId: 'l_dahej',
          qty: 85000, startDate: in1Day.toISOString(), endDate: in5Days.toISOString(), status: 'IN_TRANSIT'
        },
        {
          id: 'm_l2', stream: 'LNG', scheduleVersionId: svId3, vesselId: 'v_lng2', productId: 'p8', sourceId: 'l_australia', destId: 'l_ennore',
          qty: 80000, startDate: now.toISOString(), endDate: in10Days.toISOString(), status: 'IN_TRANSIT'
        }
      ]);

      console.log('Database seeded with enriched data.');
    }
  } catch (e) {
    console.error('Migration/Seed Error:', e);
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
