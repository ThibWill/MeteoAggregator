import { describe, it, expect } from 'vitest';
import {
  horizonDates,
  isInRange,
  leadDays,
  minutesFromUtcMidnight,
  utcDateKey,
} from '../src/domain/timeRanges.js';

const morning = { startMinute: 420, endMinute: 780 }; // 07:00-13:00

describe('timeRanges', () => {
  it('computes UTC date key', () => {
    expect(utcDateKey(new Date('2026-07-19T23:59:00Z'))).toBe('2026-07-19');
  });

  it('computes minutes from UTC midnight', () => {
    expect(minutesFromUtcMidnight(new Date('2026-07-19T07:30:00Z'), '2026-07-19')).toBe(450);
  });

  it('half-open range membership (start inclusive, end exclusive)', () => {
    expect(isInRange(new Date('2026-07-19T07:00:00Z'), '2026-07-19', morning)).toBe(true);
    expect(isInRange(new Date('2026-07-19T12:59:00Z'), '2026-07-19', morning)).toBe(true);
    expect(isInRange(new Date('2026-07-19T13:00:00Z'), '2026-07-19', morning)).toBe(false);
    expect(isInRange(new Date('2026-07-19T06:59:00Z'), '2026-07-19', morning)).toBe(false);
  });

  it('range membership respects the date', () => {
    expect(isInRange(new Date('2026-07-20T08:00:00Z'), '2026-07-19', morning)).toBe(false);
  });

  it('lists horizon dates inclusive of today', () => {
    expect(horizonDates(new Date('2026-07-19T05:00:00Z'), 2)).toEqual([
      '2026-07-19',
      '2026-07-20',
      '2026-07-21',
    ]);
  });

  it('computes whole-day lead', () => {
    expect(leadDays('2026-07-21', '2026-07-19')).toBe(2);
    expect(leadDays('2026-07-19', '2026-07-19')).toBe(0);
  });
});
