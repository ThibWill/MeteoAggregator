import { DateTime } from 'luxon';

/** A configurable intra-day window, offsets in minutes from UTC midnight. */
export interface TimeRangeDef {
  id: number;
  code: string | null;
  startMinute: number;
  endMinute: number;
  sortOrder: number;
}

/** UTC calendar date, as a `YYYY-MM-DD` string, for a JS Date. */
export function utcDateKey(d: Date): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).toISODate() as string;
}

/** Minutes-from-UTC-midnight of a valid time, relative to a given UTC date. */
export function minutesFromUtcMidnight(validTime: Date, dateKey: string): number {
  const midnight = DateTime.fromISO(dateKey, { zone: 'utc' }).startOf('day');
  const dt = DateTime.fromJSDate(validTime, { zone: 'utc' });
  return dt.diff(midnight, 'minutes').minutes;
}

/**
 * Does `validTime` fall in `[startMinute, endMinute)` of the given UTC date?
 * A range is assigned to the calendar date of its start, so no range crosses a
 * day boundary and windows are half-open (end is exclusive) to avoid double
 * counting the boundary step.
 */
export function isInRange(
  validTime: Date,
  dateKey: string,
  range: Pick<TimeRangeDef, 'startMinute' | 'endMinute'>,
): boolean {
  const m = minutesFromUtcMidnight(validTime, dateKey);
  return m >= range.startMinute && m < range.endMinute;
}

/** List of UTC target dates covered by a horizon starting "today" (inclusive). */
export function horizonDates(now: Date, maxHorizonDays: number): string[] {
  const start = DateTime.fromJSDate(now, { zone: 'utc' }).startOf('day');
  const out: string[] = [];
  for (let i = 0; i <= maxHorizonDays; i++) {
    out.push(start.plus({ days: i }).toISODate() as string);
  }
  return out;
}

/** Whole-day lead: targetDate − runDate, in days. */
export function leadDays(targetDateKey: string, runDateKey: string): number {
  const target = DateTime.fromISO(targetDateKey, { zone: 'utc' }).startOf('day');
  const run = DateTime.fromISO(runDateKey, { zone: 'utc' }).startOf('day');
  return Math.round(target.diff(run, 'days').days);
}
