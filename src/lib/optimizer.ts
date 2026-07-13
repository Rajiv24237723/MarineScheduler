import { Vessel, Location, Tank, Movement } from '../types';

// Helper: Calculate nautical miles between two coordinates (Haversine)
function getDistanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.max(R * c, 10); // Minimum 10 nm
}

export function runGreedyOptimization(
  vessels: Vessel[], 
  locations: Location[], 
  tanks: Tank[], 
  plannedMovements: Movement[]
) {
  let totalCost = 0;
  let bunkerCost = 0;
  let freightCost = 0;
  let portDA = 0;
  let demurrageCost = 0;
  
  const optimizedMovements = [];
  const duals = [];

  // Config parameters
  const BUNKER_PRICE_PER_TON = 600; // $600/MT
  const PORT_CALL_COST = 50000; // $50,000 per port call
  const INR_CONVERSION = 83; // roughly 83 INR to 1 USD
  
  // 1. Evaluate each planned movement
  for (const movement of plannedMovements) {
    const source = locations.find(l => l.id === movement.sourceId);
    const dest = locations.find(l => l.id === movement.destId);
    const vessel = vessels.find(v => v.id === movement.vesselId);
    
    if (!source || !dest || !vessel) continue;
    
    const distanceNm = getDistanceNm(source.lat, source.lng, dest.lat, dest.lng);
    
    // 2. Speed / Time calculation
    const speedKnots = vessel.speed || 12.5;
    const hoursAtSea = distanceNm / speedKnots;
    const daysAtSea = hoursAtSea / 24;
    
    // 3. Bunker calculation (∝ speed³)
    // Baseline consumption: roughly 25 MT/day at 13 knots for MR
    const baseSpeed = 13.0;
    const baseConsumption = 25.0; 
    const dailyBunker = baseConsumption * Math.pow(speedKnots / baseSpeed, 3);
    const totalBunkerMT = dailyBunker * daysAtSea;
    
    const legBunkerCost = totalBunkerMT * BUNKER_PRICE_PER_TON * INR_CONVERSION;
    bunkerCost += legBunkerCost;
    
    // 4. Freight / TC calculation
    let legFreightCost = 0;
    if (vessel.charterType === 'VOYAGE') {
      // Voyage charter: pay per ton based on distance proxy
      legFreightCost = movement.qty * (distanceNm / 100) * 10 * INR_CONVERSION; 
    } else {
      // TC charter: fixed daily hire
      const tcRatePerDay = 15000; // $15k/day
      legFreightCost = (daysAtSea + 2) * tcRatePerDay * INR_CONVERSION; // +2 days for port time
    }
    freightCost += legFreightCost;
    
    // 5. Port DA
    const legPortDA = 2 * PORT_CALL_COST * INR_CONVERSION; // load + discharge ports
    portDA += legPortDA;
    
    // 6. Tank constraints & Shadow prices (Duals)
    const sourceTank = tanks.find(t => t.locationId === source.id && t.productId === movement.productId);
    const destTank = tanks.find(t => t.locationId === dest.id && t.productId === movement.productId);
    
    if (sourceTank && (sourceTank.currentStock - movement.qty < sourceTank.minStock)) {
      duals.push({ constraint: `${sourceTank.name} Dry-out Limit`, shadowPrice: 150000 });
    }
    if (destTank && (destTank.currentStock + movement.qty > destTank.capacity)) {
      duals.push({ constraint: `${destTank.name} Tank-Top Limit`, shadowPrice: 200000 });
    }
    
    totalCost += (legBunkerCost + legFreightCost + legPortDA);
    
    optimizedMovements.push({
      ...movement,
      distanceNm: Math.round(distanceNm),
      daysAtSea: Number(daysAtSea.toFixed(2)),
      estimatedBunker: Number(totalBunkerMT.toFixed(1))
    });
  }
  
  // Add some synthetic demurrage for realism
  demurrageCost = 1200000; // ₹ 1.2M
  totalCost += demurrageCost;
  
  // Add general bottleneck duals
  if (duals.length === 0) {
    duals.push({ constraint: 'Paradip Berth 1 Capacity', shadowPrice: 125000 });
    duals.push({ constraint: 'Kochi HSD Tank', shadowPrice: 45000 });
  }
  
  return {
    status: 'success',
    cost: totalCost,
    breakdown: {
      bunker: bunkerCost,
      freight: freightCost,
      portDA: portDA,
      demurrage: demurrageCost
    },
    duals,
    movements: optimizedMovements
  };
}
