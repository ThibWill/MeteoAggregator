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
  it('groups by (source, town, time_range, lead) and counts n', () => {
    const stats = computeGroupStats([
      pair({ leadDays: 0 }),
      pair({ leadDays: 0 }),
      pair({ leadDays: 1 }),
    ]);
    expect(stats).toHaveLength(2);
    const lead0 = stats.find((s) => s.leadDays === 0)!;
    expect(lead0.n).toBe(2);
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
