export interface Product {
  id: string;
  stream: string;
  name: string;
  type: string;
  color: string;
}

export interface Location {
  id: string;
  stream: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
}

export interface Vessel {
  id: string;
  stream: string;
  name: string;
  class: string;
  dwt: number;
  charterType: string;
  speed: number;
  charterCost: number;
  compartments: { id: string; cap: number }[];
}

export interface Tank {
  id: string;
  stream: string;
  locationId: string;
  productId: string;
  capacity: number;
  minStock: number;
  currentStock: number;
  name: string;
}

export interface Movement {
  id: string;
  stream: string;
  scheduleVersionId: string;
  vesselId: string;
  productId: string;
  sourceId: string;
  destId: string;
  qty: number;
  startDate: string;
  endDate: string;
  status: string;
}

export interface DashboardData {
  vessels: Vessel[];
  tanks: Tank[];
  locations: Location[];
  products: Product[];
  movements: Movement[];
  kpis: {
    totalCost: string;
    demurrage: string;
    utilization: string;
    dryOuts: number;
  };
}
