import type { GeoPoint } from '../types.js';
import type { Station } from './client.js';

export interface RankedStation {
  station: Station;
  distanceKm: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Rank open stations by distance to `point`, preferring expertised posts
 * (`typePoste` ≠ 5; type 5 = non-expertised) at equal-ish distance. Closed
 * posts are dropped. Returns the full ranking so a caller can fall through to
 * the next candidate if the closest lacks a required sensor.
 */
export function rankStations(point: GeoPoint, stations: Station[]): RankedStation[] {
  return stations
    .filter((s) => s.posteOuvert && Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((station) => ({
      station,
      distanceKm: haversineKm(point, { lat: station.lat, lon: station.lon }),
    }))
    .sort((a, b) => {
      const aExpert = a.station.typePoste !== 5 ? 0 : 1;
      const bExpert = b.station.typePoste !== 5 ? 0 : 1;
      // Only let expertise break near-ties (within 10 km); distance dominates.
      if (Math.abs(a.distanceKm - b.distanceKm) <= 10 && aExpert !== bExpert) {
        return aExpert - bExpert;
      }
      return a.distanceKm - b.distanceKm;
    });
}

/** Normalize a DPClim station id to the 8-digit DDCCCNNN string form. */
export function stationIdToString(id: number | string): string {
  return String(id).padStart(8, '0');
}
