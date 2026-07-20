import { DateTime } from 'luxon';
import { loadEnv } from '../config/env.js';
import { prisma } from '../db/client.js';
import {
  completeObservationDates,
  loadActiveForecastPairs,
  loadActiveTimeRanges,
  replaceReportMeasurements,
  saveTownCoordinates,
  type ActiveForecastPair,
  type UpsertMeasurementInput,
} from '../db/repo.js';
import { buildDefaultRegistry, type ConnectorRegistry } from '../connectors/registry.js';
import { ALL_PARAMS, type GeoPoint } from '../connectors/types.js';
import { aggregate, expectedSteps, sampleCoverage } from '../domain/aggregate.js';
import { categorize } from '../domain/categorize.js';
import {
  dateMarker,
  dayBounds,
  horizonDates,
  leadDays,
  localDateKey,
  rangeBounds,
  resolveZone,
  type TimeRangeDef,
} from '../domain/timeRanges.js';
import { geocodeTown } from '../geocoding/geocoder.js';
import { logger } from '../lib/logger.js';
import { writeObservationSamples } from './observations.js';

const log = logger.child({ task: 'dailyRun' });

export interface DailyRunOptions {
  now?: Date;
  registry?: ConnectorRegistry;
  /** Restrict to a single town name (debugging). */
  townName?: string;
  observationSourceCode?: string;
}

export interface DailyRunSummary {
  runDate: string;
  towns: number;
  succeeded: number;
  partial: number;
  failed: number;
}

export async function dailyRun(opts: DailyRunOptions = {}): Promise<DailyRunSummary> {
  const now = opts.now ?? new Date();
  const registry = opts.registry ?? buildDefaultRegistry();
  const obsSourceCode = opts.observationSourceCode ?? 'mf-climatologie';
  const obsLookbackDays = safeLookbackDays();
  const stepMinutes = safeStepMinutes();

  const timeRanges = await loadActiveTimeRanges();
  let pairs = await loadActiveForecastPairs();
  if (opts.townName) {
    pairs = pairs.filter((p) => p.town.name.toLowerCase() === opts.townName!.toLowerCase());
  }

  const obsSource = await prisma.source.findUnique({ where: { code: obsSourceCode } });

  const summary: DailyRunSummary = {
    runDate: localDateKey(now),
    towns: pairs.length,
    succeeded: 0,
    partial: 0,
    failed: 0,
  };

  for (const pair of pairs) {
    const zone = resolveZone(pair.town.timezone);
    // Each town's run day is its own local day, so `lead_days` stays a whole
    // number of that town's days.
    const runDateKey = localDateKey(now, zone);
    const runDate = dateMarker(runDateKey);
    const townLog = log.child({ town: pair.town.name, source: pair.sourceCode });
    const report = await prisma.report.upsert({
      where: {
        runDate_townId_sourceId: {
          runDate,
          townId: pair.townId,
          sourceId: pair.sourceId,
        },
      },
      create: {
        runDate,
        townId: pair.townId,
        sourceId: pair.sourceId,
        horizonDays: pair.maxHorizonDays,
        status: 'PENDING',
        startedAt: now,
      },
      update: { status: 'PENDING', startedAt: now, error: null, finishedAt: null },
    });

    try {
      const point = await ensureGeocoded(pair);
      const connector = registry.getForecast(pair.sourceCode);
      if (!connector) throw new Error(`no forecast connector for ${pair.sourceCode}`);

      const samples = await connector.fetchForecast(point, { now, params: ALL_PARAMS, zone });
      const referenceTime = connectorReference(samples) ?? now;
      const coverage = sampleCoverage(samples, stepMinutes);
      let windowsOutOfRun = 0;
      let windowsSkipped = 0;
      const forecastRows: UpsertMeasurementInput[] = [];

      for (const targetDateKey of horizonDates(now, pair.maxHorizonDays, zone)) {
        const targetDate = dateMarker(targetDateKey);
        for (const range of timeRanges) {
          const bounds = rangeBounds(targetDateKey, range, zone);
          // A window the run only partly spans (the one straddling the run
          // start, or the tail past the horizon) would aggregate from a
          // fraction of its hours — precipitation especially, since it sums.
          // Drop it rather than write a silently biased row.
          if (!coverage || bounds.start < coverage.start || bounds.end > coverage.end) {
            windowsOutOfRun++;
            continue;
          }
          const agg = aggregate(samples, targetDateKey, range, zone);
          if (!agg || agg.raw.stepCount < expectedSteps(bounds, stepMinutes)) {
            windowsSkipped++;
            continue;
          }
          const cat = categorize(agg);
          forecastRows.push({
            reportId: report.id,
            townId: pair.townId,
            sourceId: pair.sourceId,
            kind: 'FORECAST',
            targetDate,
            timeRangeId: range.id,
            referenceTime,
            runDate,
            leadDays: leadDays(targetDateKey, runDateKey),
            leadMinutes: Math.round(
              (bounds.start.getTime() - referenceTime.getTime()) / 60_000,
            ),
            values: {
              precipitationMm: agg.precipitationMm,
              cloudCoverPct: agg.cloudCoverPct,
              temperatureC: agg.temperatureC,
              windSpeedMs: agg.windSpeedMs,
              windGustMs: agg.windGustMs,
              capeJkg: agg.capeJkg,
            },
            category: cat.category,
            precipLevel: cat.precipLevel,
            raw: agg.raw as never,
          });
        }
      }

      // Replace this report's rows atomically — but only when we actually have
      // fresh rows, so a fetch that succeeded yet yielded nothing (transient
      // upstream errors) never wipes previously-good data.
      const windowsWritten = forecastRows.length;
      if (windowsWritten > 0) {
        await replaceReportMeasurements(report.id, forecastRows);
      }

      // Observations: the qualified archive lags, so backfill J-1..J-N, only
      // the days still missing in the DB. Tolerant: a failure here never fails
      // the forecast report.
      if (obsSource) {
        try {
          await writeObservations(
            registry,
            obsSource.id,
            obsSourceCode,
            pair,
            point,
            now,
            obsLookbackDays,
            timeRanges,
            zone,
            townLog,
          );
        } catch (err) {
          townLog.warn('observation write failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Windows outside the run's span are expected (an evening run cannot
      // forecast this morning), so only genuine data holes downgrade to PARTIAL.
      const status = windowsWritten === 0 ? 'FAILED' : windowsSkipped > 0 ? 'PARTIAL' : 'SUCCESS';
      await prisma.report.update({
        where: { id: report.id },
        data: {
          status,
          modelRunTime: connectorReference(samples),
          finishedAt: new Date(),
        },
      });
      if (status === 'SUCCESS') summary.succeeded++;
      else if (status === 'PARTIAL') summary.partial++;
      else summary.failed++;
      townLog.info('town done', { status, windowsWritten, windowsSkipped, windowsOutOfRun });
    } catch (err) {
      summary.failed++;
      const message = err instanceof Error ? err.message : String(err);
      townLog.error('town failed', { error: message });
      await prisma.report.update({
        where: { id: report.id },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      });
    }
  }

  log.info('daily run complete', { ...summary });
  return summary;
}

function connectorReference(samples: { referenceTime: Date }[]): Date | null {
  return samples[0]?.referenceTime ?? null;
}

async function writeObservations(
  registry: ConnectorRegistry,
  obsSourceId: number,
  obsSourceCode: string,
  pair: ActiveForecastPair,
  point: GeoPoint,
  now: Date,
  lookbackDays: number,
  timeRanges: TimeRangeDef[],
  zone: string,
  townLog: ReturnType<typeof logger.child>,
): Promise<void> {
  const obsConnector = registry.getObservation(obsSourceCode);
  if (!obsConnector) return;

  // J-1 .. J-lookbackDays (archive is not real time; J is incomplete).
  const startOfToday = DateTime.fromJSDate(now, { zone }).startOf('day');
  const wanted: string[] = [];
  for (let i = 1; i <= lookbackDays; i++) {
    wanted.push(startOfToday.minus({ days: i }).toISODate() as string);
  }
  const oldest = startOfToday.minus({ days: lookbackDays }).toISODate() as string;
  const newest = startOfToday.minus({ days: 1 }).toISODate() as string;
  const complete = await completeObservationDates(
    obsSourceId,
    pair.townId,
    dateMarker(oldest),
    dateMarker(newest),
    timeRanges.length,
  );
  const missing = wanted.filter((d) => !complete.has(d));
  if (missing.length === 0) {
    townLog.debug('observations up to date', { lookbackDays });
    return;
  }

  // Instants, not date markers: a local day starts before UTC midnight.
  const from = dayBounds(oldest, zone).start;
  const to = dayBounds(newest, zone).end;
  const samples = await obsConnector.fetchObservationsRange(point, from, to, {
    params: ALL_PARAMS,
    townId: pair.townId,
    sourceId: obsSourceId,
    townName: pair.town.name,
  });
  if (samples.length === 0) {
    townLog.debug('no observations returned', { missing });
    return;
  }
  const written = await writeObservationSamples({
    obsSourceId,
    townId: pair.townId,
    dayKeys: missing,
    samples,
    timeRanges,
    zone,
  });
  townLog.info('observations written', { days: missing.length, rows: written });
}

function safeLookbackDays(): number {
  try {
    return loadEnv().OBS_LOOKBACK_DAYS;
  } catch {
    return 3;
  }
}

/** Native forecast step spacing, mirroring the connector's stride. */
function safeStepMinutes(): number {
  try {
    return loadEnv().AROME_STEP_HOURS * 60;
  } catch {
    return 60;
  }
}

/** Geocode + persist a town if it has no centroid yet. Returns its point. */
export async function ensureGeocoded(pair: ActiveForecastPair): Promise<GeoPoint> {
  if (pair.town.latitude !== null && pair.town.longitude !== null) {
    return { lat: pair.town.latitude, lon: pair.town.longitude };
  }
  const result = await geocodeTown({ name: pair.town.name, country: pair.town.country });
  if (!result) throw new Error(`geocoding failed for ${pair.town.name}`);
  await saveTownCoordinates(pair.townId, result.latitude, result.longitude);
  return { lat: result.latitude, lon: result.longitude };
}
