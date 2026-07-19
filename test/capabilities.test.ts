import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  parseCapabilities,
  parseRunToken,
  resolveLatestRun,
  splitCoverageId,
} from '../src/connectors/arome/capabilities.js';
import { ALL_PARAMS } from '../src/connectors/types.js';

const xml = readFileSync(
  fileURLToPath(new URL('./fixtures/getcapabilities.xml', import.meta.url)),
  'utf8',
);

describe('capabilities parsing', () => {
  it('splits coverage id into param/level and run token', () => {
    const { paramLevel, runToken } = splitCoverageId(
      'TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___2026-07-19T00.00.00Z',
    );
    expect(paramLevel).toBe('TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND');
    expect(runToken).toBe('2026-07-19T00.00.00Z');
  });

  it('parses the dotted run token into a Date', () => {
    const d = parseRunToken('2026-07-19T03.00.00Z');
    expect(d?.toISOString()).toBe('2026-07-19T03:00:00.000Z');
  });

  it('parses coverages and maps params (not matching unrelated coverages)', () => {
    const coverages = parseCapabilities(xml);
    expect(coverages.length).toBe(11);
    const humidity = coverages.find((c) => c.paramLevel.startsWith('RELATIVE_HUMIDITY'));
    expect(humidity?.param).toBeNull();
    const temp = coverages.find((c) => c.coverageId.includes('TEMPERATURE'));
    expect(temp?.param).toBe('temperature_c');
  });

  it('parses the accumulation-period suffix on precip coverages', () => {
    const coverages = parseCapabilities(xml);
    const pt1h = coverages.find((c) => c.coverageId.endsWith('03.00.00Z_PT1H'));
    const pt3h = coverages.find((c) => c.coverageId.endsWith('03.00.00Z_PT3H'));
    expect(pt1h?.param).toBe('precipitation_mm');
    expect(pt1h?.period).toBe('PT1H');
    expect(pt3h?.period).toBe('PT3H');
    // the period suffix must not corrupt the parsed run time
    expect(pt1h?.referenceTime?.toISOString()).toBe('2026-07-19T03:00:00.000Z');
  });

  it('does not confuse WIND_SPEED with WIND_SPEED_GUST', () => {
    const coverages = parseCapabilities(xml);
    const speed = coverages.find((c) => c.paramLevel === 'WIND_SPEED__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND');
    const gust = coverages.find((c) => c.paramLevel === 'WIND_SPEED_GUST__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND');
    expect(speed?.param).toBe('wind_speed_ms');
    expect(gust?.param).toBe('wind_gust_ms');
  });

  it('resolves the latest run not in the future', () => {
    const coverages = parseCapabilities(xml);
    // now = 06:00Z: the 03Z run is the latest <= now; 12Z is in the future.
    const run = resolveLatestRun(coverages, ALL_PARAMS, new Date('2026-07-19T06:00:00Z'));
    expect(run).not.toBeNull();
    expect(run!.referenceTime.toISOString()).toBe('2026-07-19T03:00:00.000Z');
    // 03Z run only published precip + temperature in the fixture.
    expect(run!.coverages.temperature_c).toContain('03.00.00Z');
    expect(run!.coverages.cloud_cover_pct).toBeUndefined();
    // precip must resolve to the PT1H coverage, never the PT3H decoy.
    expect(run!.coverages.precipitation_mm).toBe(
      'TOTAL_PRECIPITATION__GROUND_OR_WATER_SURFACE___2026-07-19T03.00.00Z_PT1H',
    );
  });

  it('falls back to an earlier fully-populated run when appropriate', () => {
    const coverages = parseCapabilities(xml);
    // now = 01:00Z: only the 00Z run qualifies (03Z and 12Z are future).
    const run = resolveLatestRun(coverages, ALL_PARAMS, new Date('2026-07-19T01:00:00Z'));
    expect(run!.referenceTime.toISOString()).toBe('2026-07-19T00:00:00.000Z');
    expect(run!.coverages.cape_jkg).toContain('00.00.00Z');
  });
});
