import { describe, it, expect } from 'vitest';
import { categorize, precipLevel } from '../src/domain/categorize.js';

function agg(over: Partial<Parameters<typeof categorize>[0]> = {}) {
  return {
    precipitationMm: null,
    cloudCoverPct: null,
    temperatureC: null,
    windGustMs: null,
    capeJkg: null,
    ...over,
  };
}

describe('precipLevel', () => {
  it('bands precipitation', () => {
    expect(precipLevel(null)).toBe('NONE');
    expect(precipLevel(0.05)).toBe('NONE');
    expect(precipLevel(1.0)).toBe('LIGHT');
    expect(precipLevel(5.0)).toBe('MODERATE');
    expect(precipLevel(10.0)).toBe('HEAVY');
  });
});

describe('categorize', () => {
  it('clear/partly/cloudy by cloud cover when dry', () => {
    expect(categorize(agg({ cloudCoverPct: 10 })).category).toBe('CLEAR');
    expect(categorize(agg({ cloudCoverPct: 40 })).category).toBe('PARTLY_CLOUDY');
    expect(categorize(agg({ cloudCoverPct: 90 })).category).toBe('CLOUDY');
  });

  it('rainy and heavy rain by precip', () => {
    expect(categorize(agg({ precipitationMm: 1.0, cloudCoverPct: 90 })).category).toBe('RAINY');
    expect(categorize(agg({ precipitationMm: 10, cloudCoverPct: 90 })).category).toBe('HEAVY_RAIN');
  });

  it('stormy when CAPE high and precip at least moderate', () => {
    const c = categorize(agg({ precipitationMm: 5, capeJkg: 1200 }));
    expect(c.category).toBe('STORMY');
    expect(c.precipLevel).toBe('MODERATE');
  });

  it('stormy on high gust with moderate precip', () => {
    expect(categorize(agg({ precipitationMm: 5, windGustMs: 30 })).category).toBe('STORMY');
  });

  it('snowy when precipitating and cold takes priority over rain', () => {
    expect(categorize(agg({ precipitationMm: 2, temperatureC: 0 })).category).toBe('SNOWY');
  });

  it('does not go stormy on high CAPE alone without enough precip', () => {
    expect(categorize(agg({ precipitationMm: 1.0, capeJkg: 1200 })).category).toBe('RAINY');
  });
});
