import { XMLParser } from 'fast-xml-parser';
import type { GeoPoint } from '../types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

export interface CoverageDescription {
  /** Axis labels in order, e.g. ["long","lat","height","time"]. */
  axisLabels: string[];
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  /** Available valid times (UTC), derived from beginPosition + time-axis coefficients. */
  timeSteps: Date[];
  /** True if a height/vertical axis is present. */
  hasHeight: boolean;
  /** Available height-level values (metres), if a height axis is present. */
  heightLevels: number[];
}

function textOf(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'string') return node.trim() || undefined;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    if (typeof t === 'string' || typeof t === 'number') return String(t).trim() || undefined;
  }
  return undefined;
}

function firstDefined(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    const t = textOf(v);
    if (t !== undefined) return t;
  }
  return undefined;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseNums(s: string | undefined): number[] {
  if (!s) return [];
  return s
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/**
 * Parse a WCS 2.0 DescribeCoverage document (Météo-France AROME flavour).
 *
 * Time axis: AROME encodes valid times as **seconds offsets** in the time
 * axis `coefficients`, relative to `boundedBy/EnvelopeWithTimePeriod/beginPosition`.
 * So validTime[i] = beginPosition + coefficient[i] seconds.
 */
export function parseDescribeCoverage(xml: string): CoverageDescription {
  const doc = parser.parse(xml);
  const root =
    doc.CoverageDescriptions?.CoverageDescription ?? doc.CoverageDescription ?? doc;
  const desc = Array.isArray(root) ? root[0] : root;

  const bounded = desc?.boundedBy ?? {};
  const envelope = bounded.EnvelopeWithTimePeriod ?? bounded.Envelope ?? {};

  const axisLabelsRaw = firstDefined(envelope['@_axisLabels'], envelope.axisLabels);
  const axisLabels = axisLabelsRaw ? axisLabelsRaw.split(/\s+/) : [];

  const lo = parseNums(firstDefined(envelope.lowerCorner));
  const hi = parseNums(firstDefined(envelope.upperCorner));
  const latIdx = indexOfAxis(axisLabels, ['lat', 'latitude', 'y'], 1);
  const lonIdx = indexOfAxis(axisLabels, ['long', 'lon', 'longitude', 'x'], 0);
  const latMin = pick(lo[latIdx], hi[latIdx], Math.min);
  const latMax = pick(lo[latIdx], hi[latIdx], Math.max);
  const lonMin = pick(lo[lonIdx], hi[lonIdx], Math.min);
  const lonMax = pick(lo[lonIdx], hi[lonIdx], Math.max);

  // Reference time for the seconds-offset coefficients.
  const beginIso = firstDefined(envelope.beginPosition);
  const beginMs = beginIso ? Date.parse(beginIso) : NaN;

  // Walk the general grid axes to find time (seconds) and height (metres).
  const grid =
    desc?.domainSet?.ReferenceableGridByVectors ??
    desc?.domainSet?.ReferenceableGridByArray ??
    {};
  const axes = asArray<Record<string, unknown>>(grid.generalGridAxis).map(
    (g) => (g.GeneralGridAxis ?? g) as Record<string, unknown>,
  );

  let timeSeconds: number[] = [];
  let heightLevels: number[] = [];
  for (const axis of axes) {
    const spanned = firstDefined(axis.gridAxesSpanned);
    const coeffs = parseNums(firstDefined(axis.coefficients));
    if (spanned === 'time') timeSeconds = coeffs;
    else if (spanned === 'height') heightLevels = coeffs;
  }

  const timeSteps = Number.isFinite(beginMs)
    ? timeSeconds.map((s) => new Date(beginMs + s * 1000))
    : [];

  const hasHeight = axisLabels.some((a) => /height|vertical|z|pressure/i.test(a));

  return { axisLabels, latMin, latMax, lonMin, lonMax, timeSteps, hasHeight, heightLevels };
}

function indexOfAxis(labels: string[], names: string[], fallback: number): number {
  const i = labels.findIndex((l) => names.includes(l.toLowerCase()));
  return i >= 0 ? i : fallback;
}

function pick(
  a: number | undefined,
  b: number | undefined,
  fn: (x: number, y: number) => number,
): number {
  const av = a ?? NaN;
  const bv = b ?? NaN;
  if (Number.isNaN(av)) return bv;
  if (Number.isNaN(bv)) return av;
  return fn(av, bv);
}

export interface SubsetOptions {
  /** Half-size of the sampling bbox in degrees around the centroid. */
  halfBoxDeg?: number;
  heightMeters?: number;
  latLabel?: string;
  lonLabel?: string;
  heightLabel?: string;
}

/** Format a valid time the way the AROME WCS expects: unquoted ISO8601Z, no millis. */
export function formatWcsTime(time: Date): string {
  return time.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build the repeatable `subset` query values for a GetCoverage request that
 * reduces the coverage to a small 2-D (lat×long) window at one time/height.
 *
 * IMPORTANT: AROME rejects the WCS-standard *quoted* time (`time("…")`) with a
 * misleading "Synopsis backend error" 404 — the time value must be **unquoted**.
 */
export function buildSubsets(point: GeoPoint, time: Date, opts: SubsetOptions = {}): string[] {
  // Default spans >=2 AROME grid cells (grid step 0.025 deg) so the request is a
  // valid 2-D trim; the nearest-pixel read still returns the centroid's cell.
  const half = opts.halfBoxDeg ?? 0.05;
  const latLabel = opts.latLabel ?? 'lat';
  const lonLabel = opts.lonLabel ?? 'long';
  const subsets = [
    `${latLabel}(${(point.lat - half).toFixed(4)},${(point.lat + half).toFixed(4)})`,
    `${lonLabel}(${(point.lon - half).toFixed(4)},${(point.lon + half).toFixed(4)})`,
    `time(${formatWcsTime(time)})`,
  ];
  if (opts.heightMeters !== undefined) {
    const heightLabel = opts.heightLabel ?? 'height';
    subsets.push(`${heightLabel}(${opts.heightMeters})`);
  }
  return subsets;
}
