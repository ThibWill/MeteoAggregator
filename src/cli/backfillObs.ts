import { DateTime } from 'luxon';
import { prisma, disconnect } from '../db/client.js';
import { buildDefaultRegistry } from '../connectors/registry.js';
import { ALL_PARAMS, type GeoPoint } from '../connectors/types.js';
import { loadActiveTimeRanges } from '../db/repo.js';
import { dayBounds, resolveZone } from '../domain/timeRanges.js';
import { writeObservationSamples } from '../tasks/observations.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ cli: 'backfill:obs' });

const OBS_SOURCE_CODE = 'mf-climatologie';

function argValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

/** Inclusive [from, to] local day range from --from/--to or --days (default 365). */
function resolveRange(zone: string): { from: DateTime; to: DateTime } {
  const startOfToday = DateTime.now().setZone(zone).startOf('day');
  const fromArg = argValue('from');
  const toArg = argValue('to');
  if (fromArg || toArg) {
    const to = toArg
      ? DateTime.fromISO(toArg, { zone }).startOf('day')
      : startOfToday.minus({ days: 1 });
    const from = fromArg
      ? DateTime.fromISO(fromArg, { zone }).startOf('day')
      : to.minus({ days: 364 });
    return { from, to };
  }
  const days = Number(argValue('days') ?? '365');
  const to = startOfToday.minus({ days: 1 });
  const from = startOfToday.minus({ days });
  return { from, to };
}

function dayKeysBetween(from: DateTime, to: DateTime): string[] {
  const keys: string[] = [];
  for (let d = from; d <= to; d = d.plus({ days: 1 })) {
    keys.push(d.toISODate() as string);
  }
  return keys;
}

async function main(): Promise<void> {
  const townName = argValue('town');
  const registry = buildDefaultRegistry();
  const connector = registry.getObservation(OBS_SOURCE_CODE);
  if (!connector) throw new Error(`no observation connector for ${OBS_SOURCE_CODE}`);

  const timeRanges = await loadActiveTimeRanges();
  const source = await prisma.source.findUnique({ where: { code: OBS_SOURCE_CODE } });
  if (!source) throw new Error(`source ${OBS_SOURCE_CODE} not seeded`);

  const pairs = await prisma.townSource.findMany({
    where: { active: true, sourceId: source.id, town: { active: true } },
    include: { town: true },
  });
  const targets = townName
    ? pairs.filter((p) => p.town.name.toLowerCase() === townName.toLowerCase())
    : pairs;

  for (const pair of targets) {
    const town = pair.town;
    if (town.latitude === null || town.longitude === null) {
      log.warn('skip town without coordinates', { town: town.name });
      continue;
    }
    const point: GeoPoint = { lat: town.latitude, lon: town.longitude };
    const townLog = log.child({ town: town.name });
    const zone = resolveZone(town.timezone);
    const { from, to } = resolveRange(zone);
    if (!from.isValid || !to.isValid || from > to) {
      throw new Error(`invalid range: ${from.toISODate()} .. ${to.toISODate()}`);
    }
    const dayKeys = dayKeysBetween(from, to);
    const fromDate = dayBounds(from.toISODate() as string, zone).start;
    const toDate = dayBounds(to.toISODate() as string, zone).end;
    townLog.info('backfill range', { zone, from: from.toISODate(), days: dayKeys.length });
    try {
      const samples = await connector.fetchObservationsRange(point, fromDate, toDate, {
        params: ALL_PARAMS,
        townId: town.id,
        sourceId: source.id,
        townName: town.name,
      });
      if (samples.length === 0) {
        townLog.warn('no observations returned for range');
        continue;
      }
      const written = await writeObservationSamples({
        obsSourceId: source.id,
        townId: town.id,
        dayKeys,
        samples,
        timeRanges,
        zone,
      });
      townLog.info('backfilled', { samples: samples.length, rows: written });
    } catch (err) {
      townLog.error('backfill failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

main()
  .catch((err) => {
    log.error('backfill:obs failed', { error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  .finally(() => disconnect());
