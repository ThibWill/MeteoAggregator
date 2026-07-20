// Deterministic sample data, used only when the API is unreachable so the UI is
// still explorable. Applies the same thresholds/categorization rules as the
// server (src/domain/categorize.ts) so behaviour is realistic.
import type { Measurement, MeasurementKind, TimeRange, Town, WeatherCategory } from './types';

export const DEMO_TOWNS: Town[] = [
  town(1, 'Lyon', 45.764, 4.8357),
  town(3, 'Paris', 48.8566, 2.3522),
  town(2, 'Mulhouse', 47.7508, 7.3359),
  town(4, 'Plouha', 48.6769, -2.93),
];

export const DEMO_RANGES: TimeRange[] = [
  range(1, 'night', 0, 420, 0),
  range(2, 'morning', 420, 780, 1),
  range(3, 'afternoon', 780, 1140, 2),
  range(4, 'evening', 1140, 1440, 3),
];

function town(id: number, name: string, latitude: number, longitude: number): Town {
  return {
    id,
    name,
    country: 'FR',
    adminArea: null,
    latitude,
    longitude,
    timezone: 'Europe/Paris',
    active: true,
    geocodedAt: null,
  };
}
function range(id: number, code: string, startMinute: number, endMinute: number, sortOrder: number): TimeRange {
  const f = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { id, code, startMinute, endMinute, sortOrder, label: `${f(startMinute)}–${f(endMinute % 1440)}` };
}

const T = { precip: { light: 0.1, moderate: 2.5, heavy: 7.6 }, cloud: { clear: 20, partly: 60 }, storm: { cape: 800, gust: 25 }, snow: 0.5 };

function precipLevel(p: number): Measurement['precipLevel'] {
  if (p >= T.precip.heavy) return 'HEAVY';
  if (p >= T.precip.moderate) return 'MODERATE';
  if (p >= T.precip.light) return 'LIGHT';
  return 'NONE';
}
function categorize(v: { precipitationMm: number; cloudCoverPct: number; temperatureC: number; windGustMs: number; capeJkg: number }): WeatherCategory {
  const level = precipLevel(v.precipitationMm);
  const rank = { NONE: 0, LIGHT: 1, MODERATE: 2, HEAVY: 3 }[level];
  const stormy = (v.capeJkg > T.storm.cape || v.windGustMs > T.storm.gust) && rank >= 2;
  if (stormy) return 'STORMY';
  if (rank >= 1 && v.temperatureC <= T.snow) return 'SNOWY';
  if (level === 'HEAVY') return 'HEAVY_RAIN';
  if (rank >= 1) return 'RAINY';
  return v.cloudCoverPct < T.cloud.clear ? 'CLEAR' : v.cloudCoverPct < T.cloud.partly ? 'PARTLY_CLOUDY' : 'CLOUDY';
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let idSeq = 1;
export function demoMeasurement(town: Town, date: string, timeRangeId: number, kind: MeasurementKind): Measurement {
  const r = rng(hash(`${town.id}|${date}|${timeRangeId}|${kind}`));
  const month = parseInt(date.slice(5, 7), 10);
  const seasonal = 13 + 11 * Math.cos(((month - 7) / 12) * 2 * Math.PI);
  const latAdj = (47 - (town.latitude ?? 47)) * 0.65;
  const pAdj = ({ 2: 0, 3: 5, 4: 1, 1: -4 } as Record<number, number>)[timeRangeId] ?? 0;
  const temperatureC = seasonal + latAdj + pAdj + (r() * 4 - 2);
  const cloudCoverPct = Math.floor(r() * 100);
  let precipitationMm = 0;
  const wet = r();
  if (cloudCoverPct > 55 && wet > 0.42) precipitationMm = r() * (cloudCoverPct > 80 ? 9.5 : 3);
  else if (wet > 0.88) precipitationMm = r() * 1.4;
  const windGustMs = 3 + r() * 24;
  const windSpeedMs = windGustMs * (0.55 + r() * 0.15);
  const capeJkg = cloudCoverPct > 68 && temperatureC > 19 ? r() * 1400 : r() * 260;
  const values = { precipitationMm, cloudCoverPct, temperatureC, windSpeedMs, windGustMs, capeJkg };
  return {
    id: idSeq++,
    kind,
    townId: town.id,
    sourceId: kind === 'FORECAST' ? 1 : 2,
    sourceCode: kind === 'FORECAST' ? 'AROME' : 'MF-SYNOP',
    targetDate: date,
    timeRangeId,
    timeRangeCode: DEMO_RANGES.find((t) => t.id === timeRangeId)?.code ?? null,
    referenceTime: null,
    runDate: null,
    leadDays: kind === 'FORECAST' ? 2 : null,
    values,
    category: categorize(values),
    precipLevel: precipLevel(precipitationMm),
  };
}

export function demoMeasurements(towns: Town[], date: string, timeRangeId: number): Measurement[] {
  return towns.flatMap((t) => [
    demoMeasurement(t, date, timeRangeId, 'FORECAST'),
    demoMeasurement(t, date, timeRangeId, 'OBSERVATION'),
  ]);
}
