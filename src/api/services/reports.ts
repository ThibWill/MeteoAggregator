import { z } from 'zod';
import { Prisma, type ReportStatus } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { notFound } from '../errors.js';
import { resolvePeriod } from '../period.js';
import { count, dateOnly, instant } from '../serialize.js';
import type {
  ReportDetailQuery,
  ReportListQuery,
  ReportSummaryQuery,
  ReportSummaryRowSchema,
} from '../schemas/report.js';
import { mapMeasurementRow } from './measurements.js';
import { resolveSourceIds, resolveTownId } from './resolve.js';

type ListQuery = z.infer<typeof ReportListQuery>;
type DetailQuery = z.infer<typeof ReportDetailQuery>;
type SummaryQuery = z.infer<typeof ReportSummaryQuery>;

const REPORT_INCLUDE = { _count: { select: { measurements: true } } } satisfies Prisma.ReportInclude;

type ReportRow = Prisma.ReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

function mapReport(r: ReportRow) {
  return {
    id: r.id,
    runDate: dateOnly(r.runDate) as string,
    townId: r.townId,
    sourceId: r.sourceId,
    modelRunTime: instant(r.modelRunTime),
    horizonDays: r.horizonDays,
    status: r.status,
    error: r.error,
    startedAt: instant(r.startedAt),
    finishedAt: instant(r.finishedAt),
    measurementCount: r._count.measurements,
  };
}

export async function listReports(q: ListQuery) {
  const period = resolvePeriod(q, { maxDays: null });
  const townId = await resolveTownId(q);
  const sourceIds = await resolveSourceIds({
    sourceId: q.sourceId === undefined ? undefined : [q.sourceId],
    source: q.source === undefined ? undefined : [q.source],
  });

  const where: Prisma.ReportWhereInput = {
    runDate: { gte: period.fromDate, lte: period.toDate },
    ...(townId === undefined ? {} : { townId }),
    ...(sourceIds === undefined ? {} : { sourceId: { in: sourceIds } }),
    ...(q.status === undefined ? {} : { status: q.status }),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.report.findMany({
      where,
      include: REPORT_INCLUDE,
      orderBy: [{ runDate: 'desc' }, { townId: 'asc' }, { sourceId: 'asc' }],
      take: q.limit,
      skip: q.offset,
    }),
    prisma.report.count({ where }),
  ]);

  return { data: rows.map(mapReport), meta: { total, limit: q.limit, offset: q.offset } };
}

export async function getReport(id: number, q: DetailQuery) {
  const report = await prisma.report.findUnique({ where: { id }, include: REPORT_INCLUDE });
  if (!report) throw notFound(`report not found: ${id}`);

  // Raw query so the rows carry the same joined source/time-range codes as
  // /measurements and can reuse its mapper.
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT
      m.id, m.kind, m.town_id, m.source_id, m.target_date, m.time_range_id,
      m.reference_time, m.run_date, m.lead_days,
      m.precipitation_mm, m.cloud_cover_pct, m.temperature_c,
      m.wind_speed_ms, m.wind_gust_ms, m.cape_jkg,
      m.category, m.precip_level,
      s.code AS source_code, tr.code AS time_range_code
    FROM weather_measurement m
    JOIN source s ON s.id = m.source_id
    JOIN time_range tr ON tr.id = m.time_range_id
    WHERE m.report_id = ${id}
    ORDER BY m.target_date ASC, tr.sort_order ASC, m.source_id ASC
    LIMIT ${q.limit} OFFSET ${q.offset}
  `);

  return {
    ...mapReport(report),
    measurements: rows.map((r) => mapMeasurementRow(r, false)),
    measurementMeta: {
      total: report._count.measurements,
      limit: q.limit,
      offset: q.offset,
    },
  };
}

/** Per run_date status counts — the "pipeline health" strip. */
export async function reportSummary(q: SummaryQuery) {
  const period = resolvePeriod(q, { maxDays: null });
  const rows = await prisma.report.groupBy({
    by: ['runDate', 'status'],
    where: { runDate: { gte: period.fromDate, lte: period.toDate } },
    _count: { _all: true },
  });

  type SummaryRow = z.infer<typeof ReportSummaryRowSchema>;
  const STATUS_FIELD = {
    PENDING: 'pending',
    SUCCESS: 'success',
    PARTIAL: 'partial',
    FAILED: 'failed',
  } as const satisfies Record<ReportStatus, keyof SummaryRow>;

  const byDate = new Map<string, SummaryRow>();
  for (const r of rows) {
    const key = dateOnly(r.runDate) as string;
    let entry = byDate.get(key);
    if (!entry) {
      entry = { runDate: key, total: 0, pending: 0, success: 0, partial: 0, failed: 0 };
      byDate.set(key, entry);
    }
    const n = count(r._count._all);
    entry.total += n;
    const field = STATUS_FIELD[r.status];
    entry[field] += n;
  }

  const data = [...byDate.values()].sort((a, b) => (a.runDate < b.runDate ? 1 : -1));
  return { data, meta: { total: data.length, limit: data.length, offset: 0 } };
}
