import { XMLParser } from 'fast-xml-parser';
import type { ParamKey } from '../types.js';
import { AROME_PARAMS, matchParam } from './params.js';

export interface CoverageInfo {
  coverageId: string;
  /** The `<PARAM>__<LEVEL>` portion. */
  paramLevel: string;
  /** Which logical param this coverage carries, if recognized. */
  param: ParamKey | null;
  /** Run reference time parsed from the coverage id suffix, if present. */
  referenceTime: Date | null;
  /** Raw run token as it appears in the id (colons encoded as dots). */
  runToken: string | null;
  /** Accumulation period suffix (e.g. `PT1H`, `P1D`) for accumulated fields; null otherwise. */
  period: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

/**
 * The coverage id encodes a run time after the last `___`, e.g.
 * `..._ABOVE_GROUND___2024-01-15T00.00.00Z`. Split param/level from run token.
 */
export function splitCoverageId(coverageId: string): { paramLevel: string; runToken: string | null } {
  const idx = coverageId.lastIndexOf('___');
  if (idx === -1) return { paramLevel: coverageId, runToken: null };
  return {
    paramLevel: coverageId.slice(0, idx),
    runToken: coverageId.slice(idx + 3),
  };
}

/**
 * Split a run token into its ISO run time and optional accumulation period.
 * Accumulated fields append `_PT<N>H` / `_P<N>D`, e.g.
 * `2026-07-19T12.00.00Z_PT3H` → { runIso: "2026-07-19T12.00.00Z", period: "PT3H" }.
 */
export function splitRunToken(token: string | null): { runIso: string | null; period: string | null } {
  if (!token) return { runIso: null, period: null };
  const m = token.match(/^(.*?Z)(?:_(P(?:T)?\d+[HMD]))?$/);
  if (!m) return { runIso: token, period: null };
  return { runIso: m[1] ?? token, period: m[2] ?? null };
}

/** Convert an MF run token `2024-01-15T00.00.00Z[_PT1H]` to a Date (dots in the time part → colons). */
export function parseRunToken(token: string | null): Date | null {
  const { runIso } = splitRunToken(token);
  if (!runIso) return null;
  const tIdx = runIso.indexOf('T');
  if (tIdx === -1) return null;
  const datePart = runIso.slice(0, tIdx);
  const timePart = runIso.slice(tIdx + 1).replace(/\./g, ':');
  const d = new Date(`${datePart}T${timePart}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Parse a WCS 2.0 GetCapabilities document and return the list of coverages,
 * each annotated with its logical param and run reference time.
 */
export function parseCapabilities(xml: string): CoverageInfo[] {
  const doc = parser.parse(xml);
  const caps = doc.Capabilities ?? doc.WCS_Capabilities ?? doc;
  const contents = caps.Contents ?? {};
  const summaries = asArray<Record<string, unknown>>(
    (contents.CoverageSummary as Record<string, unknown> | Record<string, unknown>[]) ?? [],
  );

  const out: CoverageInfo[] = [];
  for (const s of summaries) {
    const rawId = (s.CoverageId ?? s.Identifier ?? s['@_CoverageId']) as string | undefined;
    if (!rawId) continue;
    const coverageId = String(rawId).trim();
    const { paramLevel, runToken } = splitCoverageId(coverageId);
    out.push({
      coverageId,
      paramLevel,
      param: matchParam(paramLevel),
      referenceTime: parseRunToken(runToken),
      runToken,
      period: splitRunToken(runToken).period,
    });
  }
  return out;
}

export interface ResolvedRun {
  referenceTime: Date;
  runToken: string;
  /** Logical param → coverage id for this run. */
  coverages: Partial<Record<ParamKey, string>>;
}

/**
 * Group recognized coverages by run reference time and pick the latest run that
 * is not in the future relative to `now`. Returns the resolved param→coverage
 * map for the chosen run. For accumulated fields (precip) only the coverage
 * matching the param's required accumulation period (e.g. `PT1H`) is accepted.
 */
export function resolveLatestRun(
  coverages: CoverageInfo[],
  wantParams: ParamKey[],
  now: Date,
): ResolvedRun | null {
  const byRun = new Map<string, { time: Date; token: string; params: Map<ParamKey, string> }>();
  for (const c of coverages) {
    if (!c.param || !c.referenceTime) continue;
    if (!wantParams.includes(c.param)) continue;
    const wantPeriod = AROME_PARAMS[c.param].accumulationPeriod ?? null;
    if ((c.period ?? null) !== wantPeriod) continue;
    const key = c.referenceTime.toISOString();
    const entry =
      byRun.get(key) ?? { time: c.referenceTime, token: key, params: new Map() };
    if (!entry.params.has(c.param)) entry.params.set(c.param, c.coverageId);
    byRun.set(key, entry);
  }

  const runs = [...byRun.values()]
    .filter((r) => r.time.getTime() <= now.getTime())
    .sort((a, b) => b.time.getTime() - a.time.getTime());

  const chosen = runs[0];
  if (!chosen) return null;

  const coveragesMap: Partial<Record<ParamKey, string>> = {};
  for (const [k, v] of chosen.params) coveragesMap[k] = v;

  return { referenceTime: chosen.time, runToken: chosen.token, coverages: coveragesMap };
}
