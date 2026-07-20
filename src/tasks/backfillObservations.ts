import { DateTime } from 'luxon';
import { prisma } from '../db/client.js';
import { buildDefaultRegistry, type ConnectorRegistry } from '../connectors/registry.js';
import { ALL_PARAMS, type GeoPoint } from '../connectors/types.js';
import { loadActiveTimeRanges } from '../db/repo.js';
import { writeObservationSamples } from './observations.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ task: 'backfillObservations' });

export const DEFAULT_OBS_SOURCE_CODE = 'mf-climatologie';

export interface BackfillOptions {
  /** Inclusive UTC day bounds, `YYYY-MM-DD`. */
  from: string;
  to: string;
  townName?: string;
  observationSourceCode?: string;
  registry?: ConnectorRegistry;
}

export interface BackfillSummary {
  from: string;
  to: string;
  days: number;
  towns: number;
  succeeded: number;
  skipped: number;
  failed: number;
  rowsWritten: number;
}

function dayKeysBetween(from: DateTime, to: DateTime): string[] {
  const keys: string[] = [];
  for (let d = from; d <= to; d = d.plus({ days: 1 })) keys.push(d.toISODate() as string);
  return keys;
}

/**
 * Re-fetch the observation archive over a day range and materialize it into
 * (day x time_range) OBSERVATION rows. Shared by `npm run backfill:obs` and the
 * API's admin trigger.
 */
export async function backfillObservations(opts: BackfillOptions): Promise<BackfillSummary> {
  const from = DateTime.fromISO(opts.from, { zone: 'utc' }).startOf('day');
  const to = DateTime.fromISO(opts.to, { zone: 'utc' }).startOf('day');
  if (!from.isValid || !to.isValid || from > to) {
    throw new Error(`invalid range: ${opts.from} .. ${opts.to}`);
  }
  const dayKeys = dayKeysBetween(from, to);
  const sourceCode = opts.observationSourceCode ?? DEFAULT_OBS_SOURCE_CODE;
  log.info('backfill range', { from: from.toISODate(), to: to.toISODate(), days: dayKeys.length });

  const registry = opts.registry ?? buildDefaultRegistry();
  const connector = registry.getObservation(sourceCode);
  if (!connector) throw new Error(`no observation connector for ${sourceCode}`);

  const timeRanges = await loadActiveTimeRanges();
  const source = await prisma.source.findUnique({ where: { code: sourceCode } });
  if (!source) throw new Error(`source ${sourceCode} not seeded`);

  const pairs = await prisma.townSource.findMany({
    where: { active: true, sourceId: source.id, town: { active: true } },
    include: { town: true },
  });
  const targets = opts.townName
    ? pairs.filter((p) => p.town.name.toLowerCase() === opts.townName!.toLowerCase())
    : pairs;

  const summary: BackfillSummary = {
    from: from.toISODate() as string,
    to: to.toISODate() as string,
    days: dayKeys.length,
    towns: targets.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    rowsWritten: 0,
  };

  const fromDate = from.toJSDate();
  const toDate = to.toJSDate();
  for (const pair of targets) {
    const town = pair.town;
    const townLog = log.child({ town: town.name });
    if (town.latitude === null || town.longitude === null) {
      townLog.warn('skip town without coordinates');
      summary.skipped++;
      continue;
    }
    const point: GeoPoint = { lat: town.latitude, lon: town.longitude };
    try {
      const samples = await connector.fetchObservationsRange(point, fromDate, toDate, {
        params: ALL_PARAMS,
        townId: town.id,
        sourceId: source.id,
        townName: town.name,
      });
      if (samples.length === 0) {
        townLog.warn('no observations returned for range');
        summary.skipped++;
        continue;
      }
      const written = await writeObservationSamples({
        obsSourceId: source.id,
        townId: town.id,
        dayKeys,
        samples,
        timeRanges,
      });
      townLog.info('backfilled', { samples: samples.length, rows: written });
      summary.succeeded++;
      summary.rowsWritten += written;
    } catch (err) {
      townLog.error('backfill failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      summary.failed++;
    }
  }

  return summary;
}
