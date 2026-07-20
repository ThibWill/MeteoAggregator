import { describe, expect, it } from 'vitest';
import {
  mapMeasurementRow,
  pivotToTimeseries,
  type MeasurementPage,
} from '../../src/api/services/measurements.js';
import { mapComparisonRow } from '../../src/api/services/comparison.js';
import { minuteLabel } from '../../src/api/services/reference.js';
import { dateOnly, instant } from '../../src/api/serialize.js';

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    kind: 'FORECAST',
    town_id: 3,
    source_id: 1,
    source_code: 'arome',
    target_date: new Date('2026-07-21T00:00:00.000Z'),
    time_range_id: 2,
    time_range_code: 'morning',
    reference_time: new Date('2026-07-20T00:00:00.000Z'),
    run_date: new Date('2026-07-20T00:00:00.000Z'),
    lead_days: 1,
    precipitation_mm: 0.4,
    cloud_cover_pct: 62,
    temperature_c: 18.3,
    wind_speed_ms: 3.1,
    wind_gust_ms: 7.8,
    cape_jkg: 120,
    category: 'PARTLY_CLOUDY',
    precip_level: 'LIGHT',
    raw: { some: 'payload' },
    ...over,
  };
}

describe('serialize', () => {
  it('slices @db.Date to YYYY-MM-DD without a timezone shift', () => {
    // A UTC-midnight Date formatted locally in a negative-offset zone would
    // otherwise fall back to the previous day.
    expect(dateOnly(new Date('2026-07-21T00:00:00.000Z'))).toBe('2026-07-21');
  });

  it('renders timestamptz as full ISO with Z', () => {
    expect(instant(new Date('2026-07-20T06:15:00.000Z'))).toBe('2026-07-20T06:15:00.000Z');
  });

  it('passes null through', () => {
    expect(dateOnly(null)).toBeNull();
    expect(instant(null)).toBeNull();
  });
});

describe('mapMeasurementRow', () => {
  it('maps a joined row to the documented item shape', () => {
    expect(mapMeasurementRow(row(), false)).toEqual({
      id: 1,
      kind: 'FORECAST',
      townId: 3,
      sourceId: 1,
      sourceCode: 'arome',
      targetDate: '2026-07-21',
      timeRangeId: 2,
      timeRangeCode: 'morning',
      referenceTime: '2026-07-20T00:00:00.000Z',
      runDate: '2026-07-20',
      leadDays: 1,
      values: {
        precipitationMm: 0.4,
        cloudCoverPct: 62,
        temperatureC: 18.3,
        windSpeedMs: 3.1,
        windGustMs: 7.8,
        capeJkg: 120,
      },
      category: 'PARTLY_CLOUDY',
      precipLevel: 'LIGHT',
    });
  });

  it('excludes raw by default and includes it on request', () => {
    expect(mapMeasurementRow(row(), false)).not.toHaveProperty('raw');
    expect(mapMeasurementRow(row(), true).raw).toEqual({ some: 'payload' });
  });

  it('keeps null observation fields null', () => {
    const mapped = mapMeasurementRow(
      row({ kind: 'OBSERVATION', cape_jkg: null, lead_days: null, run_date: null }),
      false,
    );
    expect(mapped.values.capeJkg).toBeNull();
    expect(mapped.leadDays).toBeNull();
    expect(mapped.runDate).toBeNull();
  });
});

describe('pivotToTimeseries', () => {
  const page = (data: unknown[]): MeasurementPage => ({
    data: data as MeasurementPage['data'],
    meta: { total: data.length, limit: 100, offset: 0 },
  });

  it('builds a shared index and aligns points positionally', () => {
    const rows = [
      mapMeasurementRow(row({ id: 1, target_date: new Date('2026-07-21T00:00:00.000Z') }), false),
      mapMeasurementRow(
        row({ id: 2, source_id: 2, source_code: 'obs', kind: 'OBSERVATION' }),
        false,
      ),
      mapMeasurementRow(
        row({ id: 3, target_date: new Date('2026-07-22T00:00:00.000Z'), temperature_c: 20 }),
        false,
      ),
    ];
    const ts = pivotToTimeseries(page(rows));

    expect(ts.index).toEqual([
      { targetDate: '2026-07-21', timeRangeId: 2, timeRangeCode: 'morning' },
      { targetDate: '2026-07-22', timeRangeId: 2, timeRangeCode: 'morning' },
    ]);
    expect(ts.series).toHaveLength(2);

    const arome = ts.series.find((s) => s.sourceCode === 'arome');
    expect(arome?.points.map((p) => p?.temperatureC)).toEqual([18.3, 20]);

    // The observation source has no row on the second date -> a null gap.
    const obs = ts.series.find((s) => s.sourceCode === 'obs');
    expect(obs?.points).toHaveLength(2);
    expect(obs?.points[1]).toBeNull();
  });

  it('keeps the first row per slot when several model runs are returned', () => {
    const rows = [
      mapMeasurementRow(
        row({ id: 1, reference_time: new Date('2026-07-20T00:00:00.000Z'), temperature_c: 18 }),
        false,
      ),
      mapMeasurementRow(
        row({ id: 2, reference_time: new Date('2026-07-19T00:00:00.000Z'), temperature_c: 15 }),
        false,
      ),
    ];
    const ts = pivotToTimeseries(page(rows));
    expect(ts.index).toHaveLength(1);
    expect(ts.series).toHaveLength(1);
    expect(ts.series[0]?.points[0]?.temperatureC).toBe(18);
  });

  it('returns empty structures for an empty page', () => {
    const ts = pivotToTimeseries(page([]));
    expect(ts.index).toEqual([]);
    expect(ts.series).toEqual([]);
  });
});

describe('mapComparisonRow', () => {
  const viewRow = (over: Record<string, unknown> = {}) => ({
    town_id: 3,
    source_id: 1,
    source_code: 'arome',
    target_date: new Date('2026-07-19T00:00:00.000Z'),
    time_range_id: 2,
    time_range_code: 'morning',
    forecast_reference_time: new Date('2026-07-18T00:00:00.000Z'),
    forecast_run_date: new Date('2026-07-18T00:00:00.000Z'),
    lead_days: 1,
    forecast_precip_mm: 1.5,
    observed_precip_mm: 0.5,
    forecast_cloud_pct: 60,
    observed_cloud_pct: 40,
    forecast_temp_c: 20,
    observed_temp_c: 18,
    forecast_wind_ms: 3,
    observed_wind_ms: 4,
    forecast_gust_ms: 8,
    observed_gust_ms: 9,
    forecast_cape_jkg: 100,
    observed_cape_jkg: null,
    forecast_category: 'RAINY',
    observed_category: 'CLOUDY',
    forecast_precip_level: 'LIGHT',
    observed_precip_level: 'LIGHT',
    observed_source_id: 2,
    ...over,
  });

  it('computes forecast − observed deltas and the match flags', () => {
    const m = mapComparisonRow(viewRow());
    expect(m.delta.temperatureC).toBe(2);
    expect(m.delta.precipitationMm).toBe(1);
    expect(m.delta.windSpeedMs).toBe(-1);
    // cape has no observed side -> no delta rather than a misleading zero.
    expect(m.delta.capeJkg).toBeNull();
    expect(m.categoryMatch).toBe(false);
    expect(m.precipLevelMatch).toBe(true);
    expect(m.targetDate).toBe('2026-07-19');
  });

  it('reports unmatched rows with null observed side and null match flags', () => {
    const m = mapComparisonRow(
      viewRow({
        observed_source_id: null,
        observed_category: null,
        observed_precip_level: null,
        observed_temp_c: null,
      }),
    );
    expect(m.observedSourceId).toBeNull();
    expect(m.category.observed).toBeNull();
    expect(m.categoryMatch).toBeNull();
    expect(m.precipLevelMatch).toBeNull();
    expect(m.delta.temperatureC).toBeNull();
  });
});

describe('minuteLabel', () => {
  it('formats minute offsets as HH:MM', () => {
    expect(minuteLabel(0)).toBe('00:00');
    expect(minuteLabel(420)).toBe('07:00');
    expect(minuteLabel(435)).toBe('07:15');
    expect(minuteLabel(1380)).toBe('23:00');
  });
});
