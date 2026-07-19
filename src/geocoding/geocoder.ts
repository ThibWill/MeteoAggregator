import { loadEnv } from '../config/env.js';
import { httpRequest } from '../lib/http.js';
import { logger } from '../lib/logger.js';

export interface GeocodeQuery {
  name: string;
  country?: string;
  adminArea?: string | null;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  bbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  provider: 'adresse' | 'nominatim';
  label?: string;
}

const log = logger.child({ component: 'geocoder' });

/**
 * Geocode a town to a centroid lon/lat. Uses the free French BAN geocoder
 * (api-adresse.data.gouv.fr) for FR towns, falling back to Nominatim for
 * non-FR towns or FR misses.
 */
export async function geocodeTown(q: GeocodeQuery): Promise<GeocodeResult | null> {
  const country = (q.country ?? 'FR').toUpperCase();
  if (country === 'FR') {
    const fr = await geocodeAdresse(q);
    if (fr) return fr;
    log.warn('BAN geocoder miss, falling back to Nominatim', { name: q.name });
  }
  return geocodeNominatim(q);
}

async function geocodeAdresse(q: GeocodeQuery): Promise<GeocodeResult | null> {
  const env = loadEnv();
  const text = [q.name, q.adminArea].filter(Boolean).join(' ');
  const res = await httpRequest(env.GEOCODER_URL, {
    query: { q: text, type: 'municipality', limit: '1' },
    accept: 'application/json',
  });
  const json = (await res.json()) as {
    features?: { geometry?: { coordinates?: [number, number] }; properties?: { label?: string } }[];
  };
  const feat = json.features?.[0];
  const coords = feat?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lon, lat] = coords;
  return {
    latitude: lat,
    longitude: lon,
    provider: 'adresse',
    label: feat?.properties?.label,
  };
}

/**
 * Resolve a French town's département code (the DPClim `id-departement`) from
 * the BAN geocoder's INSEE `citycode`. Corsica keeps its `2A`/`2B` codes as
 * numeric `20` in DPClim, so those map to `20`.
 */
export async function geocodeDepartement(q: GeocodeQuery): Promise<number | null> {
  const env = loadEnv();
  const text = [q.name, q.adminArea].filter(Boolean).join(' ');
  const res = await httpRequest(env.GEOCODER_URL, {
    query: { q: text, type: 'municipality', limit: '1' },
    accept: 'application/json',
  });
  const json = (await res.json()) as {
    features?: { properties?: { citycode?: string; context?: string } }[];
  };
  const props = json.features?.[0]?.properties;
  if (!props) return null;
  const citycode = props.citycode ?? '';
  const prefix = citycode.slice(0, 2).toUpperCase();
  if (prefix === '2A' || prefix === '2B') return 20;
  const dept = Number(prefix);
  if (Number.isInteger(dept) && dept >= 1 && dept <= 95) return dept;
  // Fallback: `context` starts with the department code, e.g. "69, Rhône, ...".
  const ctx = Number((props.context ?? '').split(',')[0]?.trim());
  return Number.isInteger(ctx) ? ctx : null;
}

async function geocodeNominatim(q: GeocodeQuery): Promise<GeocodeResult | null> {
  const env = loadEnv();
  const res = await httpRequest(env.NOMINATIM_URL, {
    query: {
      q: [q.name, q.adminArea, q.country].filter(Boolean).join(', '),
      format: 'jsonv2',
      limit: '1',
    },
    headers: { 'User-Agent': 'MeteoAggregator/0.1 (weather forecast comparison)' },
    accept: 'application/json',
  });
  const json = (await res.json()) as {
    lat?: string;
    lon?: string;
    boundingbox?: [string, string, string, string];
    display_name?: string;
  }[];
  const first = json[0];
  if (!first?.lat || !first?.lon) return null;
  const result: GeocodeResult = {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    provider: 'nominatim',
    label: first.display_name,
  };
  if (first.boundingbox && first.boundingbox.length === 4) {
    const bb = first.boundingbox.map(Number) as [number, number, number, number];
    result.bbox = { minLat: bb[0], maxLat: bb[1], minLon: bb[2], maxLon: bb[3] };
  }
  return result;
}
