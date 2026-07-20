import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { resolvePeriod } from '../period.js';
import { count, dateOnly, instant, num } from '../serialize.js';
import type { ComparisonQuery, ComparisonRowSchema } from '../schemas/comparison.js';
import { resolveSourceIds, resolveTownId } from './resolve.js';

type Query = z.infer<typeof ComparisonQuery>;
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;

const delta = (f: number | null, o: number | null): number | null =>
  f === null || o === null ? null : f - o;

/** Row of `forecast_vs_observed`, joined to source/time-range codes. */
export function mapComparisonRow(r: Record<string, unknown>): ComparisonRow {
  const pair = (fk: string, ok: string) => ({
    forecast: num(r[fk]),
    observed: num(r[ok]),
  });
  const precip = pair('forecast_precip_mm', 'observed_precip_mm');
  const cloud = pair('forecast_cloud_pct', 'observed_cloud_pct');
  const temp = pair('forecast_temp_c', 'observed_temp_c');
  const wind = pair('forecast_wind_ms', 'observed_wind_ms');
  const gust = pair('forecast_gust_ms', 'observed_gust_ms');
  const cape = pair('forecast_cape_jkg', 'observed_cape_jkg');

  type Category = ComparisonRow['category']['forecast'];
  type Precip = ComparisonRow['precipLevel']['forecast'];
  const forecastCategory = String(r.forecast_category) as Category;
  const observedCategory =
    r.observed_category === null || r.observed_category === undefined
      ? null
      : (String(r.observed_category) as Category);
  const forecastPrecipLevel = String(r.forecast_precip_level) as Precip;
  const observedPrecipLevel =
    r.observed_precip_level === null || r.observed_precip_level === undefined
      ? null
      : (String(r.observed_precip_level) as Precip);

  return {
    townId: Number(r.town_id),
    sourceId: Number(r.source_id),
    sourceCode: String(r.source_code),
    targetDate: dateOnly(r.target_date as Date) as string,
    timeRangeId: Number(r.time_range_id),
    timeRangeCode: r.time_range_code === null ? null : String(r.time_range_code),
    referenceTime: instant(r.forecast_reference_time as Date | null),
    runDate: dateOnly(r.forecast_run_date as Date | null),
    leadDays: r.lead_days === null || r.lead_days === undefined ? null : Number(r.lead_days),
    observedSourceId:
      r.observed_source_id === null || r.observed_source_id === undefined
        ? null
        : Number(r.observed_source_id),
    precipitationMm: precip,
    cloudCoverPct: cloud,
    temperatureC: temp,
    windSpeedMs: wind,
    windGustMs: gust,
    capeJkg: cape,
    category: { forecast: forecastCategory, observed: observedCategory },
    precipLevel: { forecast: forecastPrecipLevel, observed: observedPrecipLevel },
    delta: {
      precipitationMm: delta(precip.forecast, precip.observed),
      cloudCoverPct: delta(cloud.forecast, cloud.observed),
      temperatureC: delta(temp.forecast, temp.observed),
      windSpeedMs: delta(wind.forecast, wind.observed),
      windGustMs: delta(gust.forecast, gust.observed),
      capeJkg: delta(cape.forecast, cape.observed),
    },
    categoryMatch: observedCategory === null ? null : forecastCategory === observedCategory,
    precipLevelMatch:
      observedPrecipLevel === null ? null : forecastPrecipLevel === observedPrecipLevel,
  };
}

export async function listComparison(q: Query) {
  const period = resolvePeriod(q);
  const townId = await resolveTownId(q);
  const sourceIds = await resolveSourceIds(q);

  const conds: Prisma.Sql[] = [
    Prisma.sql`v.target_date >= ${period.fromDate}`,
    Prisma.sql`v.target_date <= ${period.toDate}`,
  ];
  if (townId !== undefined) conds.push(Prisma.sql`v.town_id = ${townId}`);
  if (sourceIds) conds.push(Prisma.sql`v.source_id IN (${Prisma.join(sourceIds)})`);
  if (q.timeRangeId) {
    conds.push(Prisma.sql`v.time_range_id IN (${Prisma.join(q.timeRangeId)})`);
  }
  if (q.leadDays) conds.push(Prisma.sql`v.lead_days IN (${Prisma.join(q.leadDays)})`);
  if (q.onlyMatched) conds.push(Prisma.sql`v.observed_source_id IS NOT NULL`);
  const where = Prisma.join(conds, ' AND ');

  const base = Prisma.sql`
    FROM forecast_vs_observed v
    JOIN source s ON s.id = v.source_id
    JOIN time_range tr ON tr.id = v.time_range_id
    WHERE ${where}
  `;

  const pageQuery = prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT v.*, s.code AS source_code, tr.code AS time_range_code
    ${base}
    ORDER BY v.target_date ASC, tr.sort_order ASC, v.source_id ASC,
             v.forecast_reference_time DESC NULLS LAST
    LIMIT ${q.limit} OFFSET ${q.offset}
  `);
  const countQuery = prisma.$queryRaw<{ total: bigint }[]>(
    Prisma.sql`SELECT COUNT(*)::bigint AS total ${base}`,
  );

  const [rows, totals] = await prisma.$transaction([pageQuery, countQuery]);
  return {
    data: rows.map(mapComparisonRow),
    meta: { total: count(totals[0]?.total), limit: q.limit, offset: q.offset },
  };
}
