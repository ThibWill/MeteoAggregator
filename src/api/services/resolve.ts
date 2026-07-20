import { prisma } from '../../db/client.js';
import { notFound } from '../errors.js';

/**
 * §5.5: front-end URLs carry human keys (`?town=Lyon`), so resolve them to ids
 * here. An unknown name is a 404, never an empty result set.
 */
export async function resolveTownId(input: {
  townId?: number;
  town?: string;
}): Promise<number | undefined> {
  if (input.townId !== undefined) {
    const found = await prisma.town.findUnique({ where: { id: input.townId } });
    if (!found) throw notFound(`town not found: ${input.townId}`);
    return found.id;
  }
  if (input.town !== undefined) {
    const found = await prisma.town.findFirst({
      where: { name: { equals: input.town, mode: 'insensitive' } },
    });
    if (!found) throw notFound(`town not found: ${input.town}`);
    return found.id;
  }
  return undefined;
}

/** Resolves any mix of repeated `sourceId` / `source` params to a set of ids. */
export async function resolveSourceIds(input: {
  sourceId?: number[];
  source?: string[];
}): Promise<number[] | undefined> {
  const ids = new Set<number>(input.sourceId ?? []);
  if (ids.size > 0) {
    const found = await prisma.source.findMany({ where: { id: { in: [...ids] } } });
    const known = new Set(found.map((s) => s.id));
    for (const id of ids) if (!known.has(id)) throw notFound(`source not found: ${id}`);
  }
  for (const code of input.source ?? []) {
    const found = await prisma.source.findUnique({ where: { code } });
    if (!found) throw notFound(`source not found: ${code}`);
    ids.add(found.id);
  }
  return ids.size === 0 ? undefined : [...ids];
}

export async function resolveSourceIdByCode(code: string): Promise<number> {
  const found = await prisma.source.findUnique({ where: { code } });
  if (!found) throw notFound(`source not found: ${code}`);
  return found.id;
}

export { loadNameMaps, type NameMaps } from '../../db/repo.js';
