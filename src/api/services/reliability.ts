import { z } from 'zod';
import { computeReliability } from '../../domain/reliability.js';
import { prisma } from '../../db/client.js';
import { badRequest } from '../errors.js';
import type { ReliabilityQuery, WindowReportSchema } from '../schemas/reliability.js';
import { loadNameMaps, resolveSourceIdByCode, resolveTownId } from './resolve.js';

type Query = z.infer<typeof ReliabilityQuery>;

/**
 * `computeReliability` always fetches the full 365-day window of pairs and
 * filters in memory, so this is the slowest route. A short TTL memo keyed by
 * the resolved filter keeps a dashboard refresh from re-running it.
 */
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: EnrichedWindowReport[] }>();

/** `WindowReport` with town/source/time-range names resolved onto each group. */
export type EnrichedWindowReport = z.infer<typeof WindowReportSchema>;
export type EnrichedGroup = EnrichedWindowReport['groups'][number];

export function clearReliabilityCache(): void {
  cache.clear();
}

async function resolveForecastSourceId(q: Query): Promise<number | undefined> {
  if (q.sourceId !== undefined) {
    const found = await prisma.source.findUnique({ where: { id: q.sourceId } });
    if (!found) throw badRequest(`source not found: ${q.sourceId}`);
    return found.id;
  }
  if (q.source !== undefined) return resolveSourceIdByCode(q.source);
  return undefined;
}

export async function getReliability(q: Query): Promise<EnrichedWindowReport[]> {
  const townId = await resolveTownId(q);
  const forecastSourceId = await resolveForecastSourceId(q);
  // An unseeded observation source is not an error: it just yields no pairs.
  const observedSource = await prisma.source.findUnique({ where: { code: q.observedSource } });

  const key = `${townId ?? '*'}|${forecastSourceId ?? '*'}|${observedSource?.id ?? '*'}`;
  const hit = cache.get(key);
  const now = Date.now();
  let reports: EnrichedWindowReport[];
  if (hit && now - hit.at < CACHE_TTL_MS) {
    reports = hit.value;
  } else {
    const [raw, names] = await Promise.all([
      computeReliability({ townId, forecastSourceId, observedSourceId: observedSource?.id }),
      loadNameMaps(),
    ]);
    reports = raw.map((r) => ({
      ...r,
      groups: r.groups.map((g) => ({
        ...g,
        sourceCode: names.sources.get(g.sourceId) ?? null,
        townName: names.towns.get(g.townId) ?? null,
        timeRangeCode: names.timeRanges.get(g.timeRangeId) ?? null,
      })),
    }));
    cache.set(key, { at: now, value: reports });
  }

  if (q.window) {
    const selected = reports.filter((r) => r.window === q.window);
    if (selected.length === 0) throw badRequest(`unknown window: ${q.window}`);
    return selected;
  }
  return reports;
}
