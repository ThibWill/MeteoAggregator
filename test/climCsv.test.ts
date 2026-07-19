import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseHourlyCsv } from '../src/connectors/climatologie/csv.js';

const csv = readFileSync(
  fileURLToPath(new URL('./fixtures/clim_horaire.csv', import.meta.url)),
  'utf8',
);

describe('parseHourlyCsv', () => {
  const samples = parseHourlyCsv(csv);

  it('parses one sample per hour with UTC valid times', () => {
    expect(samples).toHaveLength(5);
    expect(samples[0]!.validTime.toISOString()).toBe('2026-07-18T06:00:00.000Z');
    expect(samples[4]!.validTime.toISOString()).toBe('2026-07-18T10:00:00.000Z');
  });

  it('maps canonical params and converts octas to percent', () => {
    expect(samples[0]!.params.precipitation_mm).toBe(0);
    expect(samples[0]!.params.temperature_c).toBe(12.4);
    expect(samples[0]!.params.wind_speed_ms).toBe(2.3);
    expect(samples[0]!.params.wind_gust_ms).toBe(5.1);
    // N = 4 octas -> 50%
    expect(samples[0]!.params.cloud_cover_pct).toBe(50);
  });

  it('accepts a decimal comma', () => {
    expect(samples[3]!.params.precipitation_mm).toBe(1.4);
  });

  it('omits empty cells instead of coercing to 0', () => {
    // Row 3 (08h): RR1 and FF are empty.
    expect(samples[2]!.params.precipitation_mm).toBeUndefined();
    expect(samples[2]!.params.wind_speed_ms).toBeUndefined();
    expect(samples[2]!.params.temperature_c).toBe(13.5);
  });

  it('does not map humidity (U)', () => {
    expect(Object.keys(samples[0]!.params)).not.toContain('humidity');
  });

  it('ignores N=9 (sky not visible)', () => {
    const parsed = parseHourlyCsv('POSTE;DATE;N;QN\n69299001;2026071812;9;1\n');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.params.cloud_cover_pct).toBeUndefined();
  });

  it('falls back to FXY when FXI is absent', () => {
    const parsed = parseHourlyCsv('POSTE;DATE;FXY;QFXY\n69299001;2026071812;11.2;1\n');
    expect(parsed[0]!.params.wind_gust_ms).toBe(11.2);
  });
});
