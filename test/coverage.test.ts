import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildSubsets, formatWcsTime, parseDescribeCoverage } from '../src/connectors/arome/coverage.js';

const xml = readFileSync(
  fileURLToPath(new URL('./fixtures/describecoverage.xml', import.meta.url)),
  'utf8',
);
const accumulatedXml = readFileSync(
  fileURLToPath(new URL('./fixtures/describecoverage-accumulated.xml', import.meta.url)),
  'utf8',
);

describe('DescribeCoverage parsing', () => {
  it('extracts axis labels, bounds, height levels, and seconds-offset time steps', () => {
    const desc = parseDescribeCoverage(xml);
    expect(desc.axisLabels).toEqual(['long', 'lat', 'height', 'time']);
    expect(desc.latMin).toBeCloseTo(37.5);
    expect(desc.latMax).toBeCloseTo(55.4);
    expect(desc.lonMin).toBeCloseTo(-12.0);
    expect(desc.lonMax).toBeCloseTo(16.0);
    expect(desc.hasHeight).toBe(true);
    expect(desc.heightLevels).toEqual([2, 10, 20, 35, 50, 75, 100]);
    // beginPosition 2026-07-19T12:00:00Z + {0,3600,7200,10800}s
    expect(desc.timeSteps.map((t) => t.toISOString())).toEqual([
      '2026-07-19T12:00:00.000Z',
      '2026-07-19T13:00:00.000Z',
      '2026-07-19T14:00:00.000Z',
      '2026-07-19T15:00:00.000Z',
    ]);
  });

  it('derives time steps from the run reference time, not beginPosition, for accumulated fields', () => {
    // Reference time is 12:00Z (from the CoverageId), but beginPosition is
    // 13:00Z (the coverage's first published step, ref+1h) while the time
    // axis coefficients (3600, 7200, 10800) are still offsets from 12:00Z.
    // Using beginPosition as the origin would double-count that first hour
    // and overrun endPosition (15:00Z) by producing a spurious 16:00Z step.
    const desc = parseDescribeCoverage(accumulatedXml);
    expect(desc.timeSteps.map((t) => t.toISOString())).toEqual([
      '2026-07-19T13:00:00.000Z',
      '2026-07-19T14:00:00.000Z',
      '2026-07-19T15:00:00.000Z',
    ]);
  });
});

describe('GetCoverage subset builder', () => {
  it('builds lat/long trims and an UNQUOTED time subset (AROME rejects quotes)', () => {
    const subsets = buildSubsets(
      { lat: 45.75, lon: 4.85 },
      new Date('2026-07-19T06:00:00Z'),
      { halfBoxDeg: 0.02 },
    );
    expect(subsets).toContain('lat(45.7300,45.7700)');
    expect(subsets).toContain('long(4.8300,4.8700)');
    expect(subsets).toContain('time(2026-07-19T06:00:00Z)'); // no quotes
    expect(subsets.some((s) => s.includes('"'))).toBe(false);
  });

  it('adds a height subset when requested', () => {
    const subsets = buildSubsets(
      { lat: 45.75, lon: 4.85 },
      new Date('2026-07-19T06:00:00Z'),
      { heightMeters: 2 },
    );
    expect(subsets.some((s) => s === 'height(2)')).toBe(true);
  });

  it('default bbox spans >=2 AROME grid cells (avoids InvalidSubsetting)', () => {
    const gridStep = 0.025;
    const subsets = buildSubsets({ lat: 47.751661, lon: 7.326517 }, new Date('2026-07-19T14:00:00Z'));
    const nums = (label: string) => {
      const s = subsets.find((x) => x.startsWith(`${label}(`))!;
      return s.slice(label.length + 1, -1).split(',').map(Number);
    };
    const [latLo, latHi] = nums('lat');
    const [lonLo, lonHi] = nums('long');
    // width must exceed one grid step so the box can never reduce to a single line
    expect(latHi! - latLo!).toBeGreaterThan(gridStep);
    expect(lonHi! - lonLo!).toBeGreaterThan(gridStep);
  });

  it('formats WCS time without quotes or milliseconds', () => {
    expect(formatWcsTime(new Date('2026-07-19T06:00:00.000Z'))).toBe('2026-07-19T06:00:00Z');
  });
});
