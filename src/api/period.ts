import { DateTime } from 'luxon';
import { badRequest } from './errors.js';
import { DEFAULT_PERIOD_DAYS, MAX_PERIOD_DAYS } from './schemas/common.js';

export interface Period {
  /** Inclusive `YYYY-MM-DD` bounds, UTC. */
  from: string;
  to: string;
  fromDate: Date;
  toDate: Date;
}

export interface ResolvePeriodOptions {
  /** Reject periods longer than this; `null` disables the cap. */
  maxDays?: number | null;
  now?: Date;
}

/**
 * Fills in the defaults from §5.3: an absent period means the last 7 days
 * ending today (UTC), so a client that passes nothing never pulls the archive.
 */
export function resolvePeriod(
  input: { from?: string; to?: string },
  opts: ResolvePeriodOptions = {},
): Period {
  const maxDays = opts.maxDays === undefined ? MAX_PERIOD_DAYS : opts.maxDays;
  const today = DateTime.fromJSDate(opts.now ?? new Date(), { zone: 'utc' }).startOf('day');

  let to: DateTime;
  let from: DateTime;
  if (input.to !== undefined) {
    to = DateTime.fromISO(input.to, { zone: 'utc' }).startOf('day');
  } else {
    to = today;
  }
  if (input.from !== undefined) {
    from = DateTime.fromISO(input.from, { zone: 'utc' }).startOf('day');
    if (input.to === undefined && from > today) to = from;
  } else {
    from = to.minus({ days: DEFAULT_PERIOD_DAYS - 1 });
  }

  if (to < from) {
    throw badRequest(`'to' (${to.toISODate()}) must be on or after 'from' (${from.toISODate()})`);
  }
  const spanDays = to.diff(from, 'days').days + 1;
  if (maxDays !== null && spanDays > maxDays) {
    throw badRequest(`period of ${spanDays} days exceeds the ${maxDays}-day maximum; narrow it`);
  }

  return {
    from: from.toISODate() as string,
    to: to.toISODate() as string,
    fromDate: from.toJSDate(),
    toDate: to.toJSDate(),
  };
}
