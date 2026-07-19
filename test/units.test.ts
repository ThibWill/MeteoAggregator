import { describe, it, expect } from 'vitest';
import { kelvinToCelsius, toCelsius, toPercent, kgm2ToMm } from '../src/domain/units.js';

describe('units', () => {
  it('converts Kelvin to Celsius', () => {
    expect(kelvinToCelsius(273.15)).toBeCloseTo(0);
    expect(kelvinToCelsius(300)).toBeCloseTo(26.85);
  });

  it('normalizes fractions to percent but leaves percents alone', () => {
    expect(toPercent(0.5)).toBe(50);
    expect(toPercent(1)).toBe(100);
    expect(toPercent(80)).toBe(80);
  });

  it('treats kg/m^2 as mm', () => {
    expect(kgm2ToMm(3.2)).toBe(3.2);
  });

  it('toCelsius tolerates Kelvin or already-Celsius tiff values', () => {
    expect(toCelsius(303.15)).toBeCloseTo(30); // Kelvin input
    expect(toCelsius(30)).toBe(30); // already Celsius (MF GeoTIFF)
    expect(toCelsius(-5)).toBe(-5); // sub-zero Celsius stays put
  });
});
