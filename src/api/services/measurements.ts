import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { badRequest } from '../errors.js';
import { resolvePeriod } from '../period.js';
import { count, dateOnly, instant, num } from '../serialize.js';
import type {
  MeasurementListQuery,
  MeasurementSchema,
  TimeseriesSchema,
} from '../schemas/measurement.js';
import { resolveSourceIds, resolveTownId } from './resolve.js';

type ListQuery = z.infer<typeof MeasurementListQuery>;

/** Derived from the response schema so the DTO and the contract cannot drift. */
export type MeasurementDto = z.infer<typeof MeasurementSchema>;

export interface MeasurementPage {
  data: MeasurementDto[];
  meta: { total: number; limit: number; offset: number };
}

/** Maps a raw joined row to the API DTO. Exported for unit tests. */
export function mapMeasurementRow(r: Record<string, unknown>, includeRaw: boolean): MeasurementDto {
  return {
    id: Number(r.id),
    kind: String(r.kind) as MeasurementDto['kind'],
    townId: Number(r.town_id),
    sourceId: Number(r.source_id),
    sourceCode: String(r.source_code),
    targetDate: dateOnly(r.target_date as Date) as string,
    timeRangeId: Number(r.time_range_id),
    timeRangeCode: r.time_range_code === null ? null : String(r.time_range_code),
    referenceTime: instant(r.reference_time as Date | null),
    runDate: dateOnly(r.run_date as Date | null),
    leadDays: r.lead_days === null || r.lead_days === undefined ? null : Number(r.lead_days),
    values: {
      precipitationMm: num(r.precipitation_mm),
      cloudCoverPct: num(r.cloud_cover_pct),
      temperatureC: num(r.temperature_c),
      windSpeedMs: num(r.wind_speed_ms),
      windGustMs: num(r.wind_gust_ms),
      capeJkg: num(r.cape_jkg),
    },
    category: String(r.category) as MeasurementDto['category'],
    precipLevel: String(r.precip_level) as MeasurementDto['precipLevel'],
    ...(includeRaw ? { raw: r.raw ?? null } : {}),
  };
}

interface ResolvedFilters {
  townId: number;
  sourceIds: number[] | undefined;
  from: string;
  to: string;
  fromDate: Date;
  toDate: Date;
}

async function resolveFilters(q: ListQuery): Promise<ResolvedFilters> {
  if (q.townId === undefined && q.town === undefined) {
    throw badRequest("a town filter is required: pass 'townId' or 'town'");
  }
  // Validate the period first: it is pure, so a bad range costs no query.
  const period = resolvePeriod(q);
  const townId = await resolveTownId(q);
  const sourceIds = await resolveSourceIds(q);
  return { townId: townId as number, sourceIds, ...period };
}

function whereClause(f: ResolvedFilters, q: ListQuery): Prisma.Sql {
  const conds: Prisma.Sql[] = [
    Prisma.sql`m.town_id = ${f.townId}`,
    Prisma.sql`m.target_date >= ${f.fromDate}`,
    Prisma.sql`m.target_date <= ${f.toDate}`,
  ];
  if (f.sourceIds) conds.push(Prisma.sql`m.source_id IN (${Prisma.join(f.sourceIds)})`);
  if (q.kind) conds.push(Prisma.sql`m.kind = ${q.kind}::"MeasurementKind"`);
  if (q.timeRangeId) {
    conds.push(Prisma.sql`m.time_range_id IN (${Prisma.join(q.timeRangeId)})`);
  }
  if (q.leadDays) conds.push(Prisma.sql`m.lead_days IN (${Prisma.join(q.leadDays)})`);
  return Prisma.join(conds, ' AND ');
}

/**
 * `latestOnly` keeps, per natural-key group, the row with the greatest
 * `reference_time` — i.e. the most recent model run for that slot. Turning it
 * off returns every run, which is what a "forecast evolution" view needs.
 */
function baseSelect(f: ResolvedFilters, q: ListQuery): Prisma.Sql {
  const where = whereClause(f, q);
  const distinct = q.latestOnly
    ? Prisma.sql`DISTINCT ON (m.town_id, m.source_id, m.kind, m.target_date, m.time_range_id)`
    : Prisma.empty;
  const innerOrder = q.latestOnly
    ? Prisma.sql`ORDER BY m.town_id, m.source_id, m.kind, m.target_date, m.time_range_id, m.reference_time DESC NULLS LAST`
    : Prisma.empty;
  const rawCol = q.include === 'raw' ? Prisma.sql`, m.raw` : Prisma.empty;

  return Prisma.sql`
    SELECT ${distinct}
      m.id, m.kind, m.town_id, m.source_id, m.target_date, m.time_range_id,
      m.reference_time, m.run_date, m.lead_days,
      m.precipitation_mm, m.cloud_cover_pct, m.temperature_c,
      m.wind_speed_ms, m.wind_gust_ms, m.cape_jkg,
      m.category, m.precip_level${rawCol},
      s.code AS source_code,
      tr.code AS time_range_code,
      tr.sort_order AS sort_order
    FROM weather_measurement m
    JOIN source s ON s.id = m.source_id
    JOIN time_range tr ON tr.id = m.time_range_id
    WHERE ${where}
    ${innerOrder}
  `;
}

export async function listMeasurements(q: ListQuery): Promise<MeasurementPage> {
  const f = await resolveFilters(q);
  const base = baseSelect(f, q);

  const pageQuery = prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT * FROM (${base}) x
    ORDER BY x.target_date ASC, x.sort_order ASC, x.source_id ASC,
             x.reference_time DESC NULLS LAST
    LIMIT ${q.limit} OFFSET ${q.offset}
  `);
  const countQuery = prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS total FROM (${base}) c
  `);

  const [rows, totals] = await prisma.$transaction([pageQuery, countQuery]);
  return {
    data: rows.map((r) => mapMeasurementRow(r, q.include === 'raw')),
    meta: { total: count(totals[0]?.total), limit: q.limit, offset: q.offset },
  };
}

export type TimeseriesResult = z.infer<typeof TimeseriesSchema>;
type TimeseriesSeries = TimeseriesResult['series'][number];

/**
 * Pivots the same rows into one series per (source, kind), aligned on a shared
 * (targetDate, timeRangeId) index — a shape a chart can bind to directly.
 */
export function pivotToTimeseries(page: MeasurementPage): TimeseriesResult {
  const index: TimeseriesResult['index'] = [];
  const indexPos = new Map<string, number>();
  for (const m of page.data) {
    const key = `${m.targetDate}|${m.timeRangeId}`;
    if (!indexPos.has(key)) {
      indexPos.set(key, index.length);
      index.push({
        targetDate: m.targetDate,
        timeRangeId: m.timeRangeId,
        timeRangeCode: m.timeRangeCode,
      });
    }
  }

  const series = new Map<string, TimeseriesSeries>();
  for (const m of page.data) {
    const key = `${m.sourceId}|${m.kind}`;
    let s = series.get(key);
    if (!s) {
      s = {
        sourceId: m.sourceId,
        sourceCode: m.sourceCode,
        kind: m.kind,
        points: new Array(index.length).fill(null),
      };
      series.set(key, s);
    }
    const pos = indexPos.get(`${m.targetDate}|${m.timeRangeId}`) as number;
    // With latestOnly=false several runs share a slot; the first row wins, and
    // the page order puts the most recent reference_time first.
    if (s.points[pos] === null) {
      s.points[pos] = {
        ...m.values,
        category: m.category,
        precipLevel: m.precipLevel,
        referenceTime: m.referenceTime,
        leadDays: m.leadDays,
      };
    }
  }

  return { index, series: [...series.values()], meta: page.meta };
}

export async function getTimeseries(q: ListQuery): Promise<TimeseriesResult> {
  return pivotToTimeseries(await listMeasurements(q));
}
