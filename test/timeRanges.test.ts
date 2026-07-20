import { describe, it, expect } from 'vitest';
import {
  dayBounds,
  horizonDates,
  isInRange,
  leadDays,
  localDateKey,
  rangeBounds,
  resolveZone,
  utcDateKey,
} from '../src/domain/timeRanges.js';

const morning = { startMinute: 420, endMinute: 780 }; // 07:00-13:00 local
const night = { startMinute: 0, endMinute: 420 };
const PARIS = 'Europe/Paris';

describe('timeRanges', () => {
  it('decodes a UTC date marker', () => {
    expect(utcDateKey(new Date('2026-07-19T00:00:00Z'))).toBe('2026-07-19');
  });

  it('assigns an instant to its local day, not its UTC day', () => {
    // 23:30 UTC is already the next day in Paris (01:30 CEST).
    expect(localDateKey(new Date('2026-07-19T23:30:00Z'), PARIS)).toBe('2026-07-20');
    expect(localDateKey(new Date('2026-07-19T23:30:00Z'), 'UTC')).toBe('2026-07-19');
  });

  it('resolves window bounds as local wall clock', () => {
    const summer = rangeBounds('2026-07-19', morning, PARIS);
    expect(summer.start.toISOString()).toBe('2026-07-19T05:00:00.000Z'); // CEST, +2
    expect(summer.end.toISOString()).toBe('2026-07-19T11:00:00.000Z');

    const winter = rangeBounds('2026-01-19', morning, PARIS);
    expect(winter.start.toISOString()).toBe('2026-01-19T06:00:00.000Z'); // CET, +1
    expect(winter.end.toISOString()).toBe('2026-01-19T12:00:00.000Z');
  });

  it('keeps wall-clock hours across DST transitions', () => {
    // Spring forward (2026-03-29): the day is 23h, but windows keep their hours.
    const spring = dayBounds('2026-03-29', PARIS);
    expect(spring.start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(spring.end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    // The night window still ends at 07:00 local despite the skipped hour.
    expect(rangeBounds('2026-03-29', night, PARIS).end.toISOString()).toBe(
      '2026-03-29T05:00:00.000Z',
    );

    // Fall back (2026-10-25): 25h day, still anchored on wall clock.
    const autumn = dayBounds('2026-10-25', PARIS);
    expect(autumn.start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(autumn.end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('half-open range membership (start inclusive, end exclusive)', () => {
    expect(isInRange(new Date('2026-07-19T05:00:00Z'), '2026-07-19', morning, PARIS)).toBe(true);
    expect(isInRange(new Date('2026-07-19T10:59:00Z'), '2026-07-19', morning, PARIS)).toBe(true);
    expect(isInRange(new Date('2026-07-19T11:00:00Z'), '2026-07-19', morning, PARIS)).toBe(false);
    expect(isInRange(new Date('2026-07-19T04:59:00Z'), '2026-07-19', morning, PARIS)).toBe(false);
  });

  it('range membership respects the date', () => {
    expect(isInRange(new Date('2026-07-20T06:00:00Z'), '2026-07-19', morning, PARIS)).toBe(false);
  });

  it('windows land on the right hours in a non-European zone', () => {
    const sydney = rangeBounds('2026-07-19', morning, 'Australia/Sydney');
    expect(sydney.start.toISOString()).toBe('2026-07-18T21:00:00.000Z'); // AEST, +10
    const denver = rangeBounds('2026-07-19', morning, 'America/Denver');
    expect(denver.start.toISOString()).toBe('2026-07-19T13:00:00.000Z'); // MDT, -6
  });

  it('lists horizon dates inclusive of the local today', () => {
    // 23:00 UTC is already 2026-07-20 in Paris.
    expect(horizonDates(new Date('2026-07-19T23:00:00Z'), 2, PARIS)).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
    ]);
    expect(horizonDates(new Date('2026-07-19T23:00:00Z'), 2, 'UTC')).toEqual([
      '2026-07-19',
      '2026-07-20',
      '2026-07-21',
    ]);
  });

  it('falls back to the configured zone for towns without a valid one', () => {
    expect(resolveZone('Australia/Sydney')).toBe('Australia/Sydney');
    expect(resolveZone(null)).toBe(PARIS);
    expect(resolveZone('Not/AZone')).toBe(PARIS);
  });

  it('computes whole-day lead', () => {
    expect(leadDays('2026-07-21', '2026-07-19')).toBe(2);
    expect(leadDays('2026-07-19', '2026-07-19')).toBe(0);
  });
});
