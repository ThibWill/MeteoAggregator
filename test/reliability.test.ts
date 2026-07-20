import { describe, it, expect } from 'vitest';
import {
  computeConfusion,
  computeGroupStats,
  type PairRow,
} from '../src/domain/reliability.js';

function pair(over: Partial<PairRow> = {}): PairRow {
  return {
    sourceId: 1,
    townId: 1,
    timeRangeId: 2,
    leadDays: 0,
    leadMinutes: 60,
    targetDate: '2026-07-18',
    forecastCategory: 'RAINY',
    observedCategory: 'RAINY',
    forecastPrecipLevel: 'LIGHT',
    observedPrecipLevel: 'LIGHT',
    forecastPrecipMm: 1,
    observedPrecipMm: 1,
    forecastTempC: 15,
    observedTempC: 15,
    forecastWindMs: 3,
    observedWindMs: 3,
    forecastGustMs: 8,
    observedGustMs: 8,
    forecastCloudPct: 80,
    observedCloudPct: 80,
    ...over,
  };
}

describe('computeGroupStats', () => {
  it('groups by (source, town, time_range, maturity) and counts n', () => {
    const stats = computeGroupStats([
      pair({ leadMinutes: 60 }),
      pair({ leadMinutes: 120 }),
      pair({ leadMinutes: 30 * 60 }),
    ]);
    expect(stats).toHaveLength(2);
    const short = stats.find((s) => s.leadBucket === '0-6h')!;
    expect(short.n).toBe(2);
    expect(short.leadHours).toBeCloseTo(1.5, 6); // mean(60, 120) minutes
  });

  it('separates equal lead_days that were issued at different hours', () => {
    // Both are "lead 0" for the evening window, but one was a 2h nowcast and
    // the other a 14h forecast — averaging them would hide the difference.
    const stats = computeGroupStats([
      pair({ leadDays: 0, leadMinutes: 2 * 60 }),
      pair({ leadDays: 0, leadMinutes: 14 * 60 }),
    ]);
    expect(stats).toHaveLength(2);
    expect(stats.map((s) => s.leadBucket)).toEqual(['0-6h', '12-24h']);
  });

  it('falls back to lead_days when the maturity is unknown', () => {
    const stats = computeGroupStats([pair({ leadDays: 2, leadMinutes: null })]);
    expect(stats[0]!.leadBucket).toBe('d2');
    expect(stats[0]!.leadHours).toBeNull();
  });

  it('computes category agreement rate', () => {
    const stats = computeGroupStats([
      pair({ forecastCategory: 'RAINY', observedCategory: 'RAINY' }),
      pair({ forecastCategory: 'CLEAR', observedCategory: 'CLOUDY' }),
    ]);
    expect(stats[0]!.catAgreePct).toBe(0.5);
  });

  it('computes temperature MAE and signed bias', () => {
    const stats = computeGroupStats([
      pair({ forecastTempC: 16, observedTempC: 15 }), // +1
      pair({ forecastTempC: 13, observedTempC: 15 }), // -2
    ]);
    expect(stats[0]!.tempMae).toBeCloseTo(1.5, 6); // (1 + 2) / 2
    expect(stats[0]!.tempBias).toBeCloseTo(-0.5, 6); // (1 - 2) / 2
  });

  it('ignores pairs where a value is missing on either side', () => {
    const stats = computeGroupStats([
      pair({ forecastTempC: 16, observedTempC: 15 }),
      pair({ forecastTempC: null, observedTempC: 15 }),
    ]);
    expect(stats[0]!.n).toBe(2);
    expect(stats[0]!.tempMae).toBeCloseTo(1, 6); // only the first pair counts
  });
});

describe('computeConfusion', () => {
  it('counts forecast x observed category cells', () => {
    const cells = computeConfusion([
      pair({ forecastCategory: 'RAINY', observedCategory: 'RAINY' }),
      pair({ forecastCategory: 'RAINY', observedCategory: 'CLOUDY' }),
      pair({ forecastCategory: 'RAINY', observedCategory: 'CLOUDY' }),
    ]);
    const rc = cells.find((c) => c.forecast === 'RAINY' && c.observed === 'CLOUDY');
    expect(rc?.count).toBe(2);
    const rr = cells.find((c) => c.forecast === 'RAINY' && c.observed === 'RAINY');
    expect(rr?.count).toBe(1);
  });
});
