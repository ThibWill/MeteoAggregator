import { Prisma } from '@prisma/client';
import { prisma } from './client.js';
import type { TimeRangeDef } from '../domain/timeRanges.js';

export async function loadActiveTimeRanges(): Promise<TimeRangeDef[]> {
  const rows = await prisma.timeRange.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    sortOrder: r.sortOrder,
  }));
}

export interface ActiveForecastPair {
  townId: number;
  sourceId: number;
  sourceCode: string;
  maxHorizonDays: number;
  town: {
    id: number;
    name: string;
    country: string;
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;
  };
}

/** Active (town, source) pairs for FORECAST sources. */
export async function loadActiveForecastPairs(): Promise<ActiveForecastPair[]> {
  const pairs = await prisma.townSource.findMany({
    where: {
      active: true,
      town: { active: true },
      source: { active: true, kind: 'FORECAST' },
    },
    include: { town: true, source: true },
  });
  return pairs.map((p) => ({
    townId: p.townId,
    sourceId: p.sourceId,
    sourceCode: p.source.code,
    maxHorizonDays: p.source.maxHorizonDays,
    town: {
      id: p.town.id,
      name: p.town.name,
      country: p.town.country,
      latitude: p.town.latitude,
      longitude: p.town.longitude,
      timezone: p.town.timezone,
    },
  }));
}

/**
 * Local dates (`YYYY-MM-DD`) that already have OBSERVATION rows for a
 * (source, town), within `[from, to]` inclusive. Used to skip re-fetching days
 * we already backfilled.
 */
export async function existingObservationDates(
  sourceId: number,
  townId: number,
  from: Date,
  to: Date,
): Promise<Set<string>> {
  const rows = await prisma.weatherMeasurement.findMany({
    where: { sourceId, townId, kind: 'OBSERVATION', targetDate: { gte: from, lte: to } },
    distinct: ['targetDate'],
    select: { targetDate: true },
  });
  return new Set(rows.map((r) => r.targetDate.toISOString().slice(0, 10)));
}

/** Persist a geocoded centroid (and PostGIS point) for a town. */
export async function saveTownCoordinates(
  townId: number,
  lat: number,
  lon: number,
  bbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number },
): Promise<void> {
  await prisma.town.update({
    where: { id: townId },
    data: {
      latitude: lat,
      longitude: lon,
      geocodedAt: new Date(),
      ...(bbox
        ? {
            bboxMinLon: bbox.minLon,
            bboxMinLat: bbox.minLat,
            bboxMaxLon: bbox.maxLon,
            bboxMaxLat: bbox.maxLat,
          }
        : {}),
    },
  });
  // geom is an Unsupported column; set it via raw SQL.
  await prisma.$executeRaw`
    UPDATE "town" SET "geom" = ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
    WHERE "id" = ${townId}`;
}

export interface UpsertMeasurementInput {
  reportId: number | null;
  townId: number;
  sourceId: number;
  kind: 'FORECAST' | 'OBSERVATION';
  targetDate: Date;
  timeRangeId: number;
  referenceTime: Date;
  runDate: Date | null;
  leadDays: number | null;
  leadMinutes: number | null;
  values: {
    precipitationMm: number | null;
    cloudCoverPct: number | null;
    temperatureC: number | null;
    windSpeedMs: number | null;
    windGustMs: number | null;
    capeJkg: number | null;
  };
  category: string;
  precipLevel: string;
  raw: Prisma.InputJsonValue;
}

function toRowData(input: UpsertMeasurementInput) {
  return {
    reportId: input.reportId,
    townId: input.townId,
    sourceId: input.sourceId,
    kind: input.kind as never,
    targetDate: input.targetDate,
    timeRangeId: input.timeRangeId,
    referenceTime: input.referenceTime,
    runDate: input.runDate,
    leadDays: input.leadDays,
    leadMinutes: input.leadMinutes,
    precipitationMm: input.values.precipitationMm,
    cloudCoverPct: input.values.cloudCoverPct,
    temperatureC: input.values.temperatureC,
    windSpeedMs: input.values.windSpeedMs,
    windGustMs: input.values.windGustMs,
    capeJkg: input.values.capeJkg,
    category: input.category as never,
    precipLevel: input.precipLevel as never,
    raw: input.raw,
  };
}

function naturalKeyWhere(input: UpsertMeasurementInput) {
  return {
    measurement_natural_key: {
      sourceId: input.sourceId,
      kind: input.kind as never,
      townId: input.townId,
      targetDate: input.targetDate,
      timeRangeId: input.timeRangeId,
      referenceTime: input.referenceTime,
    },
  };
}

export async function upsertMeasurement(input: UpsertMeasurementInput): Promise<void> {
  const data = toRowData(input);
  await prisma.weatherMeasurement.upsert({
    where: naturalKeyWhere(input),
    create: data,
    update: data,
  });
}

/**
 * Replace exactly the measurements a report owns: delete this report's existing
 * rows and write the fresh set atomically, so a re-run leaves report ↔
 * measurement 1:1 (no stale rows from a superseded model run). Upsert (not
 * create) handles the rare case where a row's natural key already exists under a
 * different report (same model run reused across days). Call only after a
 * successful fetch produced rows, so a failed run never wipes good data.
 */
export async function replaceReportMeasurements(
  reportId: number,
  rows: UpsertMeasurementInput[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.weatherMeasurement.deleteMany({ where: { reportId } });
    for (const input of rows) {
      const data = toRowData(input);
      await tx.weatherMeasurement.upsert({
        where: naturalKeyWhere(input),
        create: data,
        update: data,
      });
    }
  });
}
