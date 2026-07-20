import { DateTime, IANAZone } from 'luxon';
import { loadEnv } from '../config/env.js';

/** A configurable intra-day window, offsets in minutes from *local* midnight. */
export interface TimeRangeDef {
  id: number;
  code: string | null;
  startMinute: number;
  endMinute: number;
  sortOrder: number;
}

export const FALLBACK_TIME_ZONE = 'Europe/Paris';

/** Configured wall-clock zone; falls back when the env isn't loadable (tests). */
export function appTimeZone(): string {
  try {
    return loadEnv().TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/**
 * A town's own zone when it has a valid one, else the configured default. Towns
 * are per-zone so windows mean the same thing in Lyon and in Sydney.
 */
export function resolveZone(townZone?: string | null): string {
  if (townZone && IANAZone.isValidZone(townZone)) return townZone;
  return appTimeZone();
}

/**
 * UTC calendar date of an instant. Only for decoding the `target_date` /
 * `run_date` markers, which are stored as `YYYY-MM-DDT00:00:00Z`; use
 * `localDateKey` to ask which day an actual instant belongs to.
 */
export function utcDateKey(d: Date): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).toISODate() as string;
}

/** The marker a local calendar date is stored under in `target_date`/`run_date`. */
export function dateMarker(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Local calendar date, as `YYYY-MM-DD`, that an instant falls on. */
export function localDateKey(d: Date, zone: string = appTimeZone()): string {
  return DateTime.fromJSDate(d, { zone }).toISODate() as string;
}

/**
 * The instant at `minute` minutes past local midnight of `dateKey`. Resolved as
 * wall clock rather than elapsed time, so windows keep their intended hours on
 * the 23h/25h DST days; `1440` is the next local midnight.
 */
function wallClock(dateKey: string, minute: number, zone: string): Date {
  const days = Math.floor(minute / 1440);
  const rest = minute - days * 1440;
  return DateTime.fromISO(dateKey, { zone })
    .startOf('day')
    .plus({ days })
    .set({ hour: Math.floor(rest / 60), minute: rest % 60, second: 0, millisecond: 0 })
    .toJSDate();
}

/** Half-open `[start, end)` instants of a window on a given local date. */
export function rangeBounds(
  dateKey: string,
  range: Pick<TimeRangeDef, 'startMinute' | 'endMinute'>,
  zone: string = appTimeZone(),
): { start: Date; end: Date } {
  return {
    start: wallClock(dateKey, range.startMinute, zone),
    end: wallClock(dateKey, range.endMinute, zone),
  };
}

/** Half-open `[start, end)` instants of a whole local calendar day. */
export function dayBounds(
  dateKey: string,
  zone: string = appTimeZone(),
): { start: Date; end: Date } {
  return rangeBounds(dateKey, { startMinute: 0, endMinute: 1440 }, zone);
}

/**
 * Does `validTime` fall in `[startMinute, endMinute)` of the given local date?
 * A range is assigned to the calendar date of its start, so no range crosses a
 * day boundary and windows are half-open (end is exclusive) to avoid double
 * counting the boundary step.
 */
export function isInRange(
  validTime: Date,
  dateKey: string,
  range: Pick<TimeRangeDef, 'startMinute' | 'endMinute'>,
  zone: string = appTimeZone(),
): boolean {
  const { start, end } = rangeBounds(dateKey, range, zone);
  const t = validTime.getTime();
  return t >= start.getTime() && t < end.getTime();
}

/** List of local target dates covered by a horizon starting "today" (inclusive). */
export function horizonDates(
  now: Date,
  maxHorizonDays: number,
  zone: string = appTimeZone(),
): string[] {
  const start = DateTime.fromJSDate(now, { zone }).startOf('day');
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
