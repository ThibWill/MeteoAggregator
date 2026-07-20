import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../db/client.js';
import { appTimeZone } from './timeRanges.js';

/** Rolling windows the reliability report is computed over. */
export const WINDOWS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '365d', days: 365 },
] as const;

/**
 * Forecast maturity buckets, in hours. `lead_days` shifts with the cron hour
 * (an evening run's "lead 0" is a few hours out, a dawn run's is most of a day),
 * so scores are grouped by how far ahead the forecast actually was.
 */
export const MATURITY_BUCKETS = [6, 12, 24, 36, 48] as const;

/** Bucket label for a lead in minutes, e.g. `6-12h`; null when unknown. */
export function maturityBucket(leadMinutes: number | null): string | null {
  if (leadMinutes === null) return null;
  const hours = leadMinutes / 60;
  let lower = 0;
  for (const upper of MATURITY_BUCKETS) {
    if (hours < upper) return `${lower}-${upper}h`;
    lower = upper;
  }
  return `${lower}h+`;
}

/** One matched forecast/observation pair (a row of `forecast_vs_observed`). */
export interface PairRow {
  sourceId: number;
  townId: number;
  timeRangeId: number;
  leadDays: number | null;
  leadMinutes: number | null;
  targetDate: string;
  forecastCategory: string;
  observedCategory: string;
  forecastPrecipLevel: string;
  observedPrecipLevel: string;
  forecastPrecipMm: number | null;
  observedPrecipMm: number | null;
  forecastTempC: number | null;
  observedTempC: number | null;
  forecastWindMs: number | null;
  observedWindMs: number | null;
  forecastGustMs: number | null;
  observedGustMs: number | null;
  forecastCloudPct: number | null;
  observedCloudPct: number | null;
}

export interface GroupStat {
  sourceId: number;
  townId: number;
  timeRangeId: number;
  leadDays: number | null;
  /** Maturity bucket the group covers; falls back to `d<lead_days>` when unknown. */
  leadBucket: string;
  /** Mean lead within the group, in hours — how far ahead these forecasts were. */
  leadHours: number | null;
  n: number;
  catAgreePct: number | null;
  precipAgreePct: number | null;
  tempMae: number | null;
  tempBias: number | null;
  precipMae: number | null;
  precipBias: number | null;
  windMae: number | null;
  windBias: number | null;
  gustMae: number | null;
  cloudMae: number | null;
}

export interface ConfusionCell {
  forecast: string;
  observed: string;
  count: number;
}

export interface WindowReport {
  window: string;
  days: number;
  since: string;
  groups: GroupStat[];
  confusion: ConfusionCell[];
}

export interface ReliabilityFilter {
  townId?: number;
  /** Forecast source id to score (defaults to all forecast sources). */
  forecastSourceId?: number;
  /** Observation source id the forecast is compared against. */
  observedSourceId?: number;
  now?: Date;
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Absolute errors over pairs where both sides are present. */
function mae(pairs: PairRow[], f: keyof PairRow, o: keyof PairRow): number | null {
  const diffs: number[] = [];
  for (const p of pairs) {
    const a = p[f] as number | null;
    const b = p[o] as number | null;
    if (a !== null && b !== null) diffs.push(Math.abs(a - b));
  }
  return mean(diffs);
}

/** Signed errors (forecast − observed) over pairs where both sides are present. */
function bias(pairs: PairRow[], f: keyof PairRow, o: keyof PairRow): number | null {
  const diffs: number[] = [];
  for (const p of pairs) {
    const a = p[f] as number | null;
    const b = p[o] as number | null;
    if (a !== null && b !== null) diffs.push(a - b);
  }
  return mean(diffs);
}

function agreement(pairs: PairRow[], f: keyof PairRow, o: keyof PairRow): number | null {
  if (pairs.length === 0) return null;
  const hits = pairs.filter((p) => p[f] === p[o]).length;
  return hits / pairs.length;
}

/** Aggregate matched pairs into per-(source, town, time_range, maturity) stats. */
export function computeGroupStats(pairs: PairRow[]): GroupStat[] {
  const groups = new Map<string, PairRow[]>();
  for (const p of pairs) {
    const bucket = maturityBucket(p.leadMinutes) ?? `d${p.leadDays}`;
    const key = `${p.sourceId}|${p.townId}|${p.timeRangeId}|${bucket}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  const out: GroupStat[] = [];
  for (const g of groups.values()) {
    const first = g[0]!;
    const leads = g.map((p) => p.leadMinutes).filter((m): m is number => m !== null);
    out.push({
      sourceId: first.sourceId,
      townId: first.townId,
      timeRangeId: first.timeRangeId,
      leadDays: first.leadDays,
      leadBucket: maturityBucket(first.leadMinutes) ?? `d${first.leadDays}`,
      leadHours: leads.length === 0 ? null : mean(leads)! / 60,
      n: g.length,
      catAgreePct: agreement(g, 'forecastCategory', 'observedCategory'),
      precipAgreePct: agreement(g, 'forecastPrecipLevel', 'observedPrecipLevel'),
      tempMae: mae(g, 'forecastTempC', 'observedTempC'),
      tempBias: bias(g, 'forecastTempC', 'observedTempC'),
      precipMae: mae(g, 'forecastPrecipMm', 'observedPrecipMm'),
      precipBias: bias(g, 'forecastPrecipMm', 'observedPrecipMm'),
      windMae: mae(g, 'forecastWindMs', 'observedWindMs'),
      windBias: bias(g, 'forecastWindMs', 'observedWindMs'),
      gustMae: mae(g, 'forecastGustMs', 'observedGustMs'),
      cloudMae: mae(g, 'forecastCloudPct', 'observedCloudPct'),
    });
  }
  return out.sort(
    (a, b) =>
      a.townId - b.townId ||
      a.timeRangeId - b.timeRangeId ||
      (a.leadHours ?? 0) - (b.leadHours ?? 0),
  );
}

/** Global category confusion matrix (rows = forecast, cols = observed). */
export function computeConfusion(pairs: PairRow[]): ConfusionCell[] {
  const counts = new Map<string, number>();
  for (const p of pairs) {
    const key = `${p.forecastCategory}|${p.observedCategory}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => {
    const [forecast = '', observed = ''] = key.split('|');
    return { forecast, observed, count };
  });
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Fetch matched pairs from the view for the widest window, applying filters. */
async function fetchPairs(filter: ReliabilityFilter, since: Date): Promise<PairRow[]> {
  const conds: Prisma.Sql[] = [
    Prisma.sql`observed_source_id IS NOT NULL`,
    Prisma.sql`target_date >= ${since}`,
  ];
  if (filter.townId !== undefined) conds.push(Prisma.sql`town_id = ${filter.townId}`);
  if (filter.forecastSourceId !== undefined) {
    conds.push(Prisma.sql`source_id = ${filter.forecastSourceId}`);
  }
  if (filter.observedSourceId !== undefined) {
    conds.push(Prisma.sql`observed_source_id = ${filter.observedSourceId}`);
  }
  const where = Prisma.join(conds, ' AND ');
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT
      source_id, town_id, time_range_id, lead_days, lead_minutes, target_date,
      forecast_category, observed_category,
      forecast_precip_level, observed_precip_level,
      forecast_precip_mm, observed_precip_mm,
      forecast_temp_c, observed_temp_c,
      forecast_wind_ms, observed_wind_ms,
      forecast_gust_ms, observed_gust_ms,
      forecast_cloud_pct, observed_cloud_pct
    FROM forecast_vs_observed
    WHERE ${where}
  `);
  return rows.map((r) => ({
    sourceId: Number(r.source_id),
    townId: Number(r.town_id),
    timeRangeId: Number(r.time_range_id),
    leadDays: num(r.lead_days),
    leadMinutes: num(r.lead_minutes),
    targetDate: (r.target_date as Date).toISOString().slice(0, 10),
    forecastCategory: String(r.forecast_category),
    observedCategory: String(r.observed_category),
    forecastPrecipLevel: String(r.forecast_precip_level),
    observedPrecipLevel: String(r.observed_precip_level),
    forecastPrecipMm: num(r.forecast_precip_mm),
    observedPrecipMm: num(r.observed_precip_mm),
    forecastTempC: num(r.forecast_temp_c),
    observedTempC: num(r.observed_temp_c),
    forecastWindMs: num(r.forecast_wind_ms),
    observedWindMs: num(r.observed_wind_ms),
    forecastGustMs: num(r.forecast_gust_ms),
    observedGustMs: num(r.observed_gust_ms),
    forecastCloudPct: num(r.forecast_cloud_pct),
    observedCloudPct: num(r.observed_cloud_pct),
  }));
}

/** Compute reliability stats for every rolling window. */
export async function computeReliability(
  filter: ReliabilityFilter = {},
): Promise<WindowReport[]> {
  const now = filter.now ?? new Date();
  const widest = Math.max(...WINDOWS.map((w) => w.days));
  const earliest = DateTime.fromJSDate(now, { zone: 'utc' })
    .startOf('day')
    .minus({ days: widest })
    .toJSDate();
  const all = await fetchPairs(filter, earliest);

  return WINDOWS.map((w) => {
    const since = DateTime.fromJSDate(now, { zone: appTimeZone() })
      .startOf('day')
      .minus({ days: w.days })
      .toISODate() as string;
    const subset = all.filter((p) => p.targetDate >= since);
    return {
      window: w.label,
      days: w.days,
      since,
      groups: computeGroupStats(subset),
      confusion: computeConfusion(subset),
    };
  });
}
