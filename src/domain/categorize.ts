import { DEFAULT_THRESHOLDS, type Thresholds } from '../config/thresholds.js';
import type { AggregatedWindow } from './aggregate.js';

// Mirror of the Prisma enums (kept as string unions so domain code has no DB dep).
export type WeatherCategory =
  | 'CLEAR'
  | 'PARTLY_CLOUDY'
  | 'CLOUDY'
  | 'FOGGY'
  | 'RAINY'
  | 'HEAVY_RAIN'
  | 'SNOWY'
  | 'STORMY';

export type PrecipLevel = 'NONE' | 'LIGHT' | 'MODERATE' | 'HEAVY';

export interface Categorized {
  category: WeatherCategory;
  precipLevel: PrecipLevel;
}

export function precipLevel(precipMm: number | null, t: Thresholds = DEFAULT_THRESHOLDS): PrecipLevel {
  if (precipMm === null || precipMm < t.precip.light) return 'NONE';
  if (precipMm < t.precip.moderate) return 'LIGHT';
  if (precipMm < t.precip.heavy) return 'MODERATE';
  return 'HEAVY';
}

const PRECIP_RANK: Record<PrecipLevel, number> = { NONE: 0, LIGHT: 1, MODERATE: 2, HEAVY: 3 };

/**
 * Derive a weather category + precip level from aggregated window values.
 * Priority order (see PLAN.md §7): STORMY > snow > heavy rain > rain > cloud.
 */
export function categorize(
  agg: Pick<
    AggregatedWindow,
    'precipitationMm' | 'cloudCoverPct' | 'temperatureC' | 'windGustMs' | 'capeJkg'
  >,
  t: Thresholds = DEFAULT_THRESHOLDS,
): Categorized {
  const level = precipLevel(agg.precipitationMm, t);
  const rank = PRECIP_RANK[level];

  const capeHigh = (agg.capeJkg ?? 0) > t.storm.capeJkg;
  const gustHigh = (agg.windGustMs ?? 0) > t.storm.gustMs;
  const isPrecipitating = rank >= PRECIP_RANK.LIGHT;
  const cold = agg.temperatureC !== null && agg.temperatureC <= t.snowTempC;

  let category: WeatherCategory;
  if ((capeHigh || gustHigh) && rank >= PRECIP_RANK.MODERATE) {
    category = 'STORMY';
  } else if (isPrecipitating && cold) {
    category = 'SNOWY';
  } else if (level === 'HEAVY') {
    category = 'HEAVY_RAIN';
  } else if (isPrecipitating) {
    category = 'RAINY';
  } else {
    const cloud = agg.cloudCoverPct ?? 0;
    if (cloud < t.cloud.clear) category = 'CLEAR';
    else if (cloud < t.cloud.partly) category = 'PARTLY_CLOUDY';
    else category = 'CLOUDY';
  }

  return { category, precipLevel: level };
}
