import { describe, it, expect } from 'vitest';
import {
  aggregate,
  expectedSteps,
  prepareSeries,
  sampleCoverage,
} from '../src/domain/aggregate.js';
import { rangeBounds } from '../src/domain/timeRanges.js';
import type { ForecastSample } from '../src/connectors/types.js';
import type { TimeRangeDef } from '../src/domain/timeRanges.js';

const REF = new Date('2026-07-19T06:00:00Z');

const morning: TimeRangeDef = {
  id: 2,
  code: 'morning',
  startMinute: 420,
  endMinute: 780,
  sortOrder: 1,
};

function s(time: string, params: ForecastSample['params']): ForecastSample {
  return { validTime: new Date(time), referenceTime: REF, params };
}

// precipitation_mm values are per-hour (PT1H) accumulations.
const samples: ForecastSample[] = [
  s('2026-07-19T07:00:00Z', {
    precipitation_mm: 1.0,
    cloud_cover_pct: 80,
    temperature_c: 15,
    wind_speed_ms: 3,
    wind_gust_ms: 8,
    cape_jkg: 100,
  }),
  s('2026-07-19T09:00:00Z', {
    precipitation_mm: 2.0,
    cloud_cover_pct: 40,
    temperature_c: 17,
    wind_speed_ms: 5,
    wind_gust_ms: 12,
    cape_jkg: 500,
  }),
  s('2026-07-19T12:00:00Z', {
    precipitation_mm: 0.5,
    cloud_cover_pct: 60,
    temperature_c: 19,
    wind_speed_ms: 4,
    wind_gust_ms: 10,
    cape_jkg: 300,
  }),
  // afternoon step — must be excluded from the morning window
  s('2026-07-19T14:00:00Z', {
    precipitation_mm: 6.0,
    cloud_cover_pct: 10,
    temperature_c: 21,
    wind_speed_ms: 6,
    wind_gust_ms: 15,
    cape_jkg: 900,
  }),
];

describe('prepareSeries', () => {
  it('keeps per-hour precipitation as an instantaneous (non-differenced) series', () => {
    const prepared = prepareSeries(samples);
    expect(prepared.deltas.precipitation_mm).toBeUndefined();
    expect(prepared.instant.precipitation_mm!.map((p) => p.value)).toEqual([1.0, 2.0, 0.5, 6.0]);
  });
});

describe('aggregateWindow', () => {
  it('aggregates the morning window with correct methods', () => {
    const agg = aggregate(samples, '2026-07-19', morning, 'UTC');
    expect(agg).not.toBeNull();
    expect(agg!.precipitationMm).toBeCloseTo(3.5); // sum(1.0, 2.0, 0.5)
    expect(agg!.cloudCoverPct).toBeCloseTo(60); // mean(80,40,60)
    expect(agg!.temperatureC).toBeCloseTo(17); // mean(15,17,19)
    expect(agg!.windSpeedMs).toBeCloseTo(4); // mean(3,5,4)
    expect(agg!.windGustMs).toBe(12); // max
    expect(agg!.capeJkg).toBe(500); // max
    expect(agg!.raw.stepCount).toBe(3);
    expect(agg!.raw.temperatureMinC).toBe(15);
    expect(agg!.raw.temperatureMaxC).toBe(19);
  });

  it('returns null when no step falls in the window (beyond horizon)', () => {
    const agg = aggregate(samples, '2026-07-25', morning, 'UTC');
    expect(agg).toBeNull();
  });

  it('windows follow the local zone, not UTC', () => {
    // In Paris the morning window is 05:00-11:00Z, so the 12:00Z step drops out
    // and 07:00/09:00Z remain.
    const agg = aggregate(samples, '2026-07-19', morning, 'Europe/Paris');
    expect(agg!.raw.stepCount).toBe(2);
    expect(agg!.precipitationMm).toBeCloseTo(3.0); // sum(1.0, 2.0)
  });

  it('keeps precipitation null when the param was never present', () => {
    const noPrecip: ForecastSample[] = [
      s('2026-07-19T08:00:00Z', { temperature_c: 16, cloud_cover_pct: 30 }),
    ];
    const agg = aggregate(noPrecip, '2026-07-19', morning, 'UTC');
    expect(agg!.precipitationMm).toBeNull();
    expect(agg!.temperatureC).toBe(16);
  });
});

describe('window coverage', () => {
  it('spans from the first step to one step past the last', () => {
    const cov = sampleCoverage(samples, 60)!;
    expect(cov.start.toISOString()).toBe('2026-07-19T07:00:00.000Z');
    expect(cov.end.toISOString()).toBe('2026-07-19T15:00:00.000Z');
  });

  it('has no coverage without samples', () => {
    expect(sampleCoverage([], 60)).toBeNull();
  });

  it('expects one step per hour of the window', () => {
    expect(expectedSteps(rangeBounds('2026-07-19', morning, 'UTC'), 60)).toBe(6);
    expect(expectedSteps(rangeBounds('2026-07-19', morning, 'UTC'), 180)).toBe(2);
  });

  it('accounts for the longer and shorter DST days', () => {
    const day = { startMinute: 0, endMinute: 1440 };
    expect(expectedSteps(rangeBounds('2026-03-29', day, 'Europe/Paris'), 60)).toBe(23);
    expect(expectedSteps(rangeBounds('2026-10-25', day, 'Europe/Paris'), 60)).toBe(25);
  });

  it('flags the window straddling the run start as not fully covered', () => {
    // A run starting at 18:00Z only covers 1 hour of the 13:00-19:00Z window.
    const lateRun = [s('2026-07-19T18:00:00Z', { precipitation_mm: 0.2 })];
    const afternoon = { startMinute: 780, endMinute: 1140 };
    const bounds = rangeBounds('2026-07-19', afternoon, 'UTC');
    const cov = sampleCoverage(lateRun, 60)!;
    expect(bounds.start < cov.start).toBe(true);

    // Aggregation alone would happily return a 1-step (biased) window.
    const agg = aggregate(lateRun, '2026-07-19', { ...morning, ...afternoon }, 'UTC');
    expect(agg!.raw.stepCount).toBe(1);
    expect(agg!.raw.stepCount).toBeLessThan(expectedSteps(bounds, 60));
  });
});
