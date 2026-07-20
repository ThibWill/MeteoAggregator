import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { notFound } from '../errors.js';
import { count, dateOnly, instant } from '../serialize.js';
import type { TownListQuery } from '../schemas/town.js';
import type { SourceListQuery } from '../schemas/source.js';

type TownQuery = z.infer<typeof TownListQuery>;
type SourceQuery = z.infer<typeof SourceListQuery>;

/** `geom` is Unsupported() and never selected — it must not reach the client. */
const TOWN_SELECT = {
  id: true,
  name: true,
  country: true,
  adminArea: true,
  latitude: true,
  longitude: true,
  timezone: true,
  active: true,
  geocodedAt: true,
} satisfies Prisma.TownSelect;

type TownRow = Prisma.TownGetPayload<{ select: typeof TOWN_SELECT }>;

function mapTown(t: TownRow) {
  return {
    id: t.id,
    name: t.name,
    country: t.country,
    adminArea: t.adminArea,
    latitude: t.latitude,
    longitude: t.longitude,
    timezone: t.timezone,
    active: t.active,
    geocodedAt: instant(t.geocodedAt),
  };
}

export async function listTowns(q: TownQuery) {
  const where: Prisma.TownWhereInput = {
    active: q.active,
    ...(q.country ? { country: q.country } : {}),
    ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}),
  };
  // Count in the same transaction as the page so `total` matches what is returned.
  const [rows, total] = await prisma.$transaction([
    prisma.town.findMany({
      where,
      select: TOWN_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: q.limit,
      skip: q.offset,
    }),
    prisma.town.count({ where }),
  ]);
  return {
    data: rows.map(mapTown),
    meta: { total, limit: q.limit, offset: q.offset },
  };
}

export async function getTown(id: number) {
  const town = await prisma.town.findUnique({ where: { id }, select: TOWN_SELECT });
  if (!town) throw notFound(`town not found: ${id}`);

  const [links, agg] = await Promise.all([
    prisma.townSource.findMany({
      where: { townId: id },
      include: { source: { select: { code: true } } },
      orderBy: { sourceId: 'asc' },
    }),
    prisma.weatherMeasurement.aggregate({
      where: { townId: id },
      _min: { targetDate: true },
      _max: { targetDate: true },
      _count: { _all: true },
    }),
  ]);

  return {
    ...mapTown(town),
    sources: links.map((l) => ({
      sourceId: l.sourceId,
      sourceCode: l.source.code,
      active: l.active,
      stationId: l.stationId,
      stationMeta: l.stationMeta ?? null,
    })),
    coverage: {
      firstTargetDate: dateOnly(agg._min.targetDate),
      lastTargetDate: dateOnly(agg._max.targetDate),
      measurementCount: count(agg._count._all),
    },
  };
}

export async function listSources(q: SourceQuery) {
  const where: Prisma.SourceWhereInput = {
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.active === undefined ? {} : { active: q.active }),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.source.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        maxHorizonDays: true,
        resolution: true,
        active: true,
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: q.limit,
      skip: q.offset,
    }),
    prisma.source.count({ where }),
  ]);
  return { data: rows, meta: { total, limit: q.limit, offset: q.offset } };
}

/** `435` -> `"07:15"`. Minutes are offsets from UTC midnight. */
export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export async function listTimeRanges() {
  const rows = await prisma.timeRange.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const data = rows.map((r) => ({
    id: r.id,
    code: r.code,
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    sortOrder: r.sortOrder,
    label: `${minuteLabel(r.startMinute)}–${minuteLabel(r.endMinute)}`,
  }));
  return { data, meta: { total: data.length, limit: data.length, offset: 0 } };
}
