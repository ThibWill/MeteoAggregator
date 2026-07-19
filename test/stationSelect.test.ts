import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  rankStations,
  stationIdToString,
} from '../src/connectors/climatologie/stations.js';
import type { Station } from '../src/connectors/climatologie/client.js';

const stations = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/liste_stations.json', import.meta.url)), 'utf8'),
) as Station[];

const LYON = { lat: 45.758, lon: 4.835 };

describe('rankStations', () => {
  const ranked = rankStations(LYON, stations);

  it('drops closed posts', () => {
    expect(ranked.some((r) => r.station.nom === 'CLOSED-STATION')).toBe(false);
    expect(ranked).toHaveLength(3);
  });

  it('prefers an expertised post over a nearer amateur (type 5) within 10 km', () => {
    expect(ranked[0]!.station.nom).toBe('LYON-BRON');
  });

  it('sorts remaining candidates by distance', () => {
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!.distanceKm).toBeGreaterThanOrEqual(ranked[i - 1]!.distanceKm - 10);
    }
  });
});

describe('haversineKm', () => {
  it('is ~0 for identical points', () => {
    expect(haversineKm(LYON, LYON)).toBeCloseTo(0, 5);
  });

  it('matches a known short distance', () => {
    // ~9 km between Lyon centroid and Lyon-Bron.
    const d = haversineKm(LYON, { lat: 45.726, lon: 4.944 });
    expect(d).toBeGreaterThan(7);
    expect(d).toBeLessThan(11);
  });
});

describe('stationIdToString', () => {
  it('pads to 8 digits', () => {
    expect(stationIdToString(1014002)).toBe('01014002');
    expect(stationIdToString(69299001)).toBe('69299001');
  });
});
