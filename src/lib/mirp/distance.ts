import { Location } from './types';

/** Great-circle distance in nautical miles (min 10 nm to avoid zero legs). */
export function haversineNm(a: Location, b: Location): number {
  const R = 3440.065; // nm
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.max(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)), 10);
}

/** Sail time in whole days (ceil) at a given speed in knots. */
export function sailDays(distanceNm: number, speedKn: number): number {
  return Math.max(1, Math.ceil(distanceNm / (Math.max(speedKn, 1) * 24)));
}

/** Daily bunker consumption (MT) at a speed, cube law off a 13 kn / 25 MT-day baseline. */
export function dailyBunkerMt(speedKn: number): number {
  return 25 * Math.pow(speedKn / 13, 3);
}

/** Deterministic RNG (mulberry32) so demos are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
