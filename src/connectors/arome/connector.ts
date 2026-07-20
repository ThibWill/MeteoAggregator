import { DateTime } from 'luxon';
import { makeLimiter } from '../../lib/concurrency.js';
import { httpRequest } from '../../lib/http.js';
import { makeRateLimiter, noopRateLimiter, type RateLimiter } from '../../lib/ratelimit.js';
import { logger } from '../../lib/logger.js';
import { kgm2ToMm, toCelsius, toPercent } from '../../domain/units.js';
import { dayBounds, resolveZone } from '../../domain/timeRanges.js';
import type {
  FetchForecastOptions,
  ForecastConnector,
  ForecastSample,
  GeoPoint,
  ParamKey,
} from '../types.js';
import {
  parseCapabilities,
  resolveLatestRun,
  type CoverageInfo,
  type ResolvedRun,
} from './capabilities.js';
import { buildSubsets, parseDescribeCoverage, type CoverageDescription } from './coverage.js';
import { readPointValue } from './geotiff.js';
import { AROME_PARAMS } from './params.js';

export interface AromeConnectorOptions {
  baseUrl: string;
  product: string;
  apiKey?: string;
  maxHorizonDays?: number;
  /** Half-size of the sampling bbox in degrees. */
  halfBoxDeg?: number;
  /** Requests/minute budget for the key tier (0/undefined = unlimited). */
  maxReqPerMin?: number;
  /** Sample every Nth hourly step (1 = every step). */
  stepHours?: number;
  /** Timeout for the (large) GetCapabilities download. */
  capsTimeoutMs?: number;
  /** How many times to re-download GetCapabilities if it looks truncated. */
  capsAttempts?: number;
}

const log = logger.child({ connector: 'arome' });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AromeConnector implements ForecastConnector {
  readonly code = 'arome-0025-france';
  readonly maxHorizonDays: number;

  private readonly baseUrl: string;
  private readonly product: string;
  private readonly apiKey?: string;
  private readonly halfBoxDeg: number;
  private readonly stepHours: number;
  private readonly capsTimeoutMs: number;
  private readonly capsAttempts: number;
  private readonly limit = makeLimiter();
  private readonly rate: RateLimiter;

  private capsCache: CoverageInfo[] | null = null;
  private describeCache = new Map<string, CoverageDescription>();

  constructor(opts: AromeConnectorOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.product = opts.product;
    this.apiKey = opts.apiKey;
    this.maxHorizonDays = opts.maxHorizonDays ?? 2;
    // Must exceed the AROME grid step (0.025 deg) so the bbox always spans >=2
    // grid cells; a smaller box can reduce to a single grid line for some
    // coordinate alignments, which the WCS rejects as InvalidSubsetting.
    this.halfBoxDeg = opts.halfBoxDeg ?? 0.05;
    this.stepHours = Math.max(1, opts.stepHours ?? 1);
    this.capsTimeoutMs = opts.capsTimeoutMs ?? 120_000;
    this.capsAttempts = Math.max(1, opts.capsAttempts ?? 4);
    this.rate = opts.maxReqPerMin ? makeRateLimiter(opts.maxReqPerMin) : noopRateLimiter;
  }

  private wcsUrl(op: string): string {
    return `${this.baseUrl}/wcs/${this.product}-WCS/${op}`;
  }

  private get auth() {
    return this.apiKey ? { apiKey: this.apiKey } : undefined;
  }

  async getCapabilities(force = false): Promise<CoverageInfo[]> {
    if (this.capsCache && !force) return this.capsCache;
    // The GetCapabilities document is large (several MB): use a generous
    // timeout, and treat a response with zero recognized params as truncated
    // (retry) rather than silently proceeding to "no usable run".
    let last: { total: number; recognized: number } = { total: 0, recognized: 0 };
    let lastError: unknown;
    for (let attempt = 0; attempt < this.capsAttempts; attempt++) {
      if (attempt > 0) await sleep(1500 * attempt);
      try {
        await this.rate.acquire();
        const res = await httpRequest(this.wcsUrl('GetCapabilities'), {
          query: { service: 'WCS', version: '2.0.1', language: 'eng' },
          auth: this.auth,
          accept: 'application/xml',
          timeoutMs: this.capsTimeoutMs,
          maxRetries: 2,
        });
        const xml = await res.text();
        const parsed = parseCapabilities(xml);
        const recognized = parsed.filter((c) => c.param).length;
        last = { total: parsed.length, recognized };
        log.debug('parsed capabilities', { coverages: parsed.length, recognized, bytes: xml.length });
        if (recognized > 0) {
          this.capsCache = parsed;
          return this.capsCache;
        }
        log.warn('GetCapabilities had 0 recognized params (likely truncated), retrying', {
          coverages: parsed.length,
          bytes: xml.length,
          attempt,
        });
      } catch (err) {
        lastError = err;
        log.warn('GetCapabilities request failed, retrying', {
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (lastError) {
      throw new Error(
        `AROME: GetCapabilities failed after ${this.capsAttempts} attempts: ` +
          (lastError instanceof Error ? lastError.message : String(lastError)),
      );
    }
    throw new Error(
      `AROME: GetCapabilities returned no recognized parameters after ${this.capsAttempts} attempts ` +
        `(got ${last.total} coverages; likely a truncated/incomplete download)`,
    );
  }

  async describeCoverage(coverageId: string): Promise<CoverageDescription> {
    const cached = this.describeCache.get(coverageId);
    if (cached) return cached;
    await this.rate.acquire();
    const res = await httpRequest(this.wcsUrl('DescribeCoverage'), {
      query: { service: 'WCS', version: '2.0.1', coverageid: coverageId },
      auth: this.auth,
      accept: 'application/xml',
    });
    const xml = await res.text();
    const desc = parseDescribeCoverage(xml);
    this.describeCache.set(coverageId, desc);
    return desc;
  }

  /** Fetch and read the single value at `point`/`time` from a coverage. */
  async getCoverageValueAtPoint(
    coverageId: string,
    point: GeoPoint,
    time: Date,
    heightMeters: number | undefined,
    axisLabels: string[],
  ): Promise<number | null> {
    const latLabel = pickLabel(axisLabels, ['lat', 'latitude', 'y'], 'lat');
    const lonLabel = pickLabel(axisLabels, ['long', 'lon', 'longitude', 'x'], 'long');
    const subsets = buildSubsets(point, time, {
      halfBoxDeg: this.halfBoxDeg,
      heightMeters,
      latLabel,
      lonLabel,
    });
    await this.rate.acquire();
    const res = await httpRequest(this.wcsUrl('GetCoverage'), {
      query: {
        service: 'WCS',
        version: '2.0.1',
        coverageid: coverageId,
        subset: subsets,
        format: 'image/tiff',
      },
      auth: this.auth,
      accept: 'image/tiff',
    });
    const buf = await res.arrayBuffer();
    const read = await readPointValue(buf, point);
    return read.value;
  }

  async fetchForecast(point: GeoPoint, opts: FetchForecastOptions): Promise<ForecastSample[]> {
    const caps = await this.getCapabilities();
    const run = resolveLatestRun(caps, opts.params, opts.now);
    if (!run) throw new Error('AROME: no usable run found in GetCapabilities');
    log.info('resolved run', {
      referenceTime: run.referenceTime.toISOString(),
      params: Object.keys(run.coverages),
    });

    // End of the last *local* target day, which for western zones runs past
    // the equivalent UTC midnight.
    const zone = resolveZone(opts.zone);
    const lastDay = DateTime.fromJSDate(opts.now, { zone })
      .startOf('day')
      .plus({ days: this.maxHorizonDays })
      .toISODate() as string;
    const horizonEnd = DateTime.fromJSDate(dayBounds(lastDay, zone).end, { zone: 'utc' });

    // Collect (param, validTime, value) samples, then group by validTime.
    const byValidTime = new Map<number, ForecastSample>();

    const tasks: Promise<void>[] = [];
    for (const param of opts.params) {
      const coverageId = run.coverages[param];
      if (!coverageId) {
        log.warn('param missing from run', { param });
        continue;
      }
      const cfg = AROME_PARAMS[param];
      const desc = await this.describeCoverage(coverageId);
      const times = this.resolveValidTimes(desc, run, horizonEnd);

      for (const time of times) {
        tasks.push(
          this.limit(async () => {
            try {
              const raw = await this.getCoverageValueAtPoint(
                coverageId,
                point,
                time,
                desc.hasHeight ? cfg.heightMeters : undefined,
                desc.axisLabels,
              );
              if (raw === null) return;
              const value = convertUnit(param, raw);
              const key = time.getTime();
              const sample =
                byValidTime.get(key) ??
                { validTime: time, referenceTime: run.referenceTime, params: {} };
              sample.params[param] = value;
              byValidTime.set(key, sample);
            } catch (err) {
              log.warn('sample failed', {
                param,
                time: time.toISOString(),
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }),
        );
      }
    }

    await Promise.all(tasks);
    const samples = [...byValidTime.values()].sort(
      (a, b) => a.validTime.getTime() - b.validTime.getTime(),
    );
    if (samples.length === 0) {
      log.warn('fetchForecast produced no samples', {
        params: Object.keys(run.coverages),
        note: 'all coverage requests returned nothing (rate limit / no data?)',
      });
    }
    return samples;
  }

  /** Prefer explicit coverage time steps; else generate hourly steps from the run. */
  private resolveValidTimes(
    desc: CoverageDescription,
    run: ResolvedRun,
    horizonEnd: DateTime,
  ): Date[] {
    const endMs = horizonEnd.toMillis();
    const startMs = run.referenceTime.getTime();
    let steps: Date[];
    if (desc.timeSteps.length > 0) {
      steps = desc.timeSteps.filter((t) => t.getTime() >= startMs && t.getTime() < endMs);
    } else {
      steps = [];
      let cursor = DateTime.fromJSDate(run.referenceTime, { zone: 'utc' });
      const cap = DateTime.fromMillis(endMs, { zone: 'utc' });
      while (cursor < cap) {
        steps.push(cursor.toJSDate());
        cursor = cursor.plus({ hours: 1 });
      }
    }
    // Apply the step stride to cut request volume (keep every Nth hourly step).
    return this.stepHours <= 1 ? steps : steps.filter((_, i) => i % this.stepHours === 0);
  }
}

function pickLabel(labels: string[], names: string[], fallback: string): string {
  const found = labels.find((l) => names.includes(l.toLowerCase()));
  return found ?? fallback;
}

export function convertUnit(param: ParamKey, raw: number): number {
  const unit = AROME_PARAMS[param].unit;
  switch (unit) {
    case 'kelvin':
      return toCelsius(raw);
    case 'fraction_or_percent':
      return toPercent(raw);
    case 'kgm2':
      return kgm2ToMm(raw);
    case 'percent':
    case 'ms':
    case 'jkg':
      return raw;
  }
}
