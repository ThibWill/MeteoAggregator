import {
  ACCUMULATED_PARAMS,
  type ForecastSample,
  type ParamKey,
} from '../connectors/types.js';
import { appTimeZone, isInRange, utcDateKey, type TimeRangeDef } from './timeRanges.js';

type AggMethod = 'accumulate' | 'mean' | 'max' | 'min';

/** How each canonical param is aggregated over a window. */
export const AGG_METHOD: Record<ParamKey, AggMethod> = {
  precipitation_mm: 'accumulate',
  cloud_cover_pct: 'mean',
  temperature_c: 'mean',
  wind_speed_ms: 'mean',
  wind_gust_ms: 'max',
  cape_jkg: 'max',
};

export interface AggregatedWindow {
  precipitationMm: number | null;
  cloudCoverPct: number | null;
  temperatureC: number | null;
  windSpeedMs: number | null;
  windGustMs: number | null;
  capeJkg: number | null;
  raw: {
    stepCount: number;
    stepTimes: string[];
    aggMethods: Partial<Record<ParamKey, AggMethod>>;
    temperatureMinC?: number;
    temperatureMaxC?: number;
  };
}

interface Point {
  validTime: Date;
  value: number;
}

interface PreparedSeries {
  /** Instantaneous values per param (sorted by validTime). */
  instant: Partial<Record<ParamKey, Point[]>>;
  /** Per-step deltas for accumulated params (delta attributed to its end step). */
  deltas: Partial<Record<ParamKey, Point[]>>;
  /** Union of all validTimes seen, sorted. */
  allTimes: Date[];
}

/**
 * Preprocess raw native-step samples into per-param series. For accumulated
 * params (precipitation), values are differenced into per-step deltas with a
 * baseline of 0 at the model run start, negatives clamped to 0.
 */
export function prepareSeries(samples: ForecastSample[]): PreparedSeries {
  const byParam = new Map<ParamKey, Point[]>();
  const allTimes = new Set<number>();

  for (const s of samples) {
    allTimes.add(s.validTime.getTime());
    for (const [k, v] of Object.entries(s.params) as [ParamKey, number | undefined][]) {
      if (v === undefined || v === null || Number.isNaN(v)) continue;
      const arr = byParam.get(k) ?? [];
      arr.push({ validTime: s.validTime, value: v });
      byParam.set(k, arr);
    }
  }

  const instant: PreparedSeries['instant'] = {};
  const deltas: PreparedSeries['deltas'] = {};

  for (const [param, points] of byParam) {
    points.sort((a, b) => a.validTime.getTime() - b.validTime.getTime());
    if (ACCUMULATED_PARAMS.has(param)) {
      const d: Point[] = [];
      let prev = 0;
      for (const p of points) {
        const step = Math.max(0, p.value - prev);
        d.push({ validTime: p.validTime, value: step });
        prev = p.value;
      }
      deltas[param] = d;
    } else {
      instant[param] = points;
    }
  }

  return {
    instant,
    deltas,
    allTimes: [...allTimes].sort((a, b) => a - b).map((t) => new Date(t)),
  };
}

function reduceValues(values: number[], method: AggMethod): number | null {
  if (values.length === 0) return null;
  switch (method) {
    case 'accumulate':
      return values.reduce((a, b) => a + b, 0);
    case 'mean':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
  }
}

function inWindow(
  points: Point[] | undefined,
  dateKey: string,
  range: TimeRangeDef,
  zone: string,
): number[] {
  if (!points) return [];
  return points.filter((p) => isInRange(p.validTime, dateKey, range, zone)).map((p) => p.value);
}

/**
 * Aggregate the native-step series into one window value per param for a given
 * (local target date, time range). Returns null if no step falls in the window
 * (e.g. beyond the model horizon) so the orchestrator can skip writing a row.
 */
export function aggregateWindow(
  prepared: PreparedSeries,
  targetDateKey: string,
  range: TimeRangeDef,
  zone: string = appTimeZone(),
): AggregatedWindow | null {
  const stepTimes = prepared.allTimes.filter((t) => isInRange(t, targetDateKey, range, zone));
  if (stepTimes.length === 0) return null;

  // Precip is per-hour (PT1H) accumulation, so sum the in-window values.
  // (deltas would only be populated for a run-cumulative source; see ACCUMULATED_PARAMS.)
  const precipSeries = prepared.instant.precipitation_mm ?? prepared.deltas.precipitation_mm;
  const precipitationMm = precipSeries
    ? reduceValues(inWindow(precipSeries, targetDateKey, range, zone), 'accumulate')
    : null;

  const cloud = reduceValues(inWindow(prepared.instant.cloud_cover_pct, targetDateKey, range, zone), 'mean');
  const tempVals = inWindow(prepared.instant.temperature_c, targetDateKey, range, zone);
  const temperatureC = reduceValues(tempVals, 'mean');
  const windSpeedMs = reduceValues(inWindow(prepared.instant.wind_speed_ms, targetDateKey, range, zone), 'mean');
  const windGustMs = reduceValues(inWindow(prepared.instant.wind_gust_ms, targetDateKey, range, zone), 'max');
  const capeJkg = reduceValues(inWindow(prepared.instant.cape_jkg, targetDateKey, range, zone), 'max');

  const raw: AggregatedWindow['raw'] = {
    stepCount: stepTimes.length,
    stepTimes: stepTimes.map((t) => t.toISOString()),
    aggMethods: {
      precipitation_mm: 'accumulate',
      cloud_cover_pct: 'mean',
      temperature_c: 'mean',
      wind_speed_ms: 'mean',
      wind_gust_ms: 'max',
      cape_jkg: 'max',
    },
  };
  if (tempVals.length > 0) {
    raw.temperatureMinC = Math.min(...tempVals);
    raw.temperatureMaxC = Math.max(...tempVals);
  }

  return {
    precipitationMm,
    cloudCoverPct: cloud,
    temperatureC,
    windSpeedMs,
    windGustMs,
    capeJkg,
    raw,
  };
}

/** Convenience: aggregate samples directly for one (date, range). */
export function aggregate(
  samples: ForecastSample[],
  targetDate: Date | string,
  range: TimeRangeDef,
  zone: string = appTimeZone(),
): AggregatedWindow | null {
  const dateKey = typeof targetDate === 'string' ? targetDate : utcDateKey(targetDate);
  return aggregateWindow(prepareSeries(samples), dateKey, range, zone);
}
