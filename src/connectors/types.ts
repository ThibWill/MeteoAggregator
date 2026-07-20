/**
 * Source-agnostic connector contracts. Everything AROME/WCS-specific lives
 * behind these so adding a new source is additive.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Logical parameter keys, in canonical units (see below). */
export type ParamKey =
  | 'precipitation_mm'
  | 'cloud_cover_pct'
  | 'temperature_c'
  | 'wind_speed_ms'
  | 'wind_gust_ms'
  | 'cape_jkg';

export const ALL_PARAMS: ParamKey[] = [
  'precipitation_mm',
  'cloud_cover_pct',
  'temperature_c',
  'wind_speed_ms',
  'wind_gust_ms',
  'cape_jkg',
];

/**
 * Canonical units, which every connector must convert into:
 *  - precipitation_mm: millimetres. NOTE: for accumulated-precip sources this is
 *    the value *accumulated since the model run start* (see `accumulated`). The
 *    orchestrator differences it across a window.
 *  - cloud_cover_pct: percent 0..100
 *  - temperature_c: degrees Celsius
 *  - wind_speed_ms / wind_gust_ms: metres per second
 *  - cape_jkg: joules per kilogram
 */
export interface ForecastSample {
  /** UTC valid time of this step. */
  validTime: Date;
  /** Model run / reference time this sample came from. */
  referenceTime: Date;
  /** Raw numeric values in canonical units. Missing params are simply absent. */
  params: Partial<Record<ParamKey, number>>;
}

/**
 * Params whose values are accumulated-since-run and must be differenced into
 * per-step deltas before windowing. Currently empty: AROME precipitation is
 * fetched as the `PT1H` (per-hour) accumulation, so each value is already this
 * hour's total and a window sum is correct without differencing. Kept as a hook
 * for any future source that only exposes a run-cumulative field.
 */
export const ACCUMULATED_PARAMS: ReadonlySet<ParamKey> = new Set<ParamKey>();

export interface FetchForecastOptions {
  now: Date;
  params: ParamKey[];
  /** Town zone; sets the local-day horizon the connector fetches steps for. */
  zone?: string;
}

export interface ForecastConnector {
  readonly code: string;
  readonly maxHorizonDays: number;
  /** Return native-step samples for a point over the horizon. */
  fetchForecast(point: GeoPoint, opts: FetchForecastOptions): Promise<ForecastSample[]>;
}

export interface FetchObservationsOptions {
  params: ParamKey[];
  /**
   * Town/source context, used by station-based sources (climatologie) to
   * resolve and persist the town↔station mapping on first fetch. Absent for
   * point-only sources.
   */
  townId?: number;
  sourceId?: number;
  townName?: string;
}

export interface ObservationConnector {
  readonly code: string;
  /** Observed values for a point for a given UTC day. */
  fetchObservations(
    point: GeoPoint,
    day: Date,
    opts: FetchObservationsOptions,
  ): Promise<ForecastSample[]>;
  /**
   * Observed values for a point over an inclusive UTC day range `[from, to]`.
   * Lets station sources issue a single archive order for a backfill span.
   */
  fetchObservationsRange(
    point: GeoPoint,
    from: Date,
    to: Date,
    opts: FetchObservationsOptions,
  ): Promise<ForecastSample[]>;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
