import { DateTime } from 'luxon';
import { disconnect } from '../db/client.js';
import { backfillObservations } from '../tasks/backfillObservations.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ cli: 'backfill:obs' });

function argValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

/** Inclusive [from, to] UTC day range from --from/--to or --days (default 365). */
function resolveRange(): { from: string; to: string } {
  const startOfToday = DateTime.utc().startOf('day');
  const fromArg = argValue('from');
  const toArg = argValue('to');
  if (fromArg || toArg) {
    const to = toArg
      ? DateTime.fromISO(toArg, { zone: 'utc' }).startOf('day')
      : startOfToday.minus({ days: 1 });
    const from = fromArg
      ? DateTime.fromISO(fromArg, { zone: 'utc' }).startOf('day')
      : to.minus({ days: 364 });
    return { from: from.toISODate() as string, to: to.toISODate() as string };
  }
  const days = Number(argValue('days') ?? '365');
  return {
    from: startOfToday.minus({ days }).toISODate() as string,
    to: startOfToday.minus({ days: 1 }).toISODate() as string,
  };
}

async function main(): Promise<void> {
  const { from, to } = resolveRange();
  const summary = await backfillObservations({ from, to, townName: argValue('town') });
  log.info('backfill complete', { ...summary });
}

main()
  .catch((err) => {
    log.error('backfill:obs failed', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(() => disconnect());
