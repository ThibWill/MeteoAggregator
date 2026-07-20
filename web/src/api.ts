import type {
  Envelope,
  Measurement,
  MeasurementKind,
  TimeRange,
  Town,
} from './types';

/**
 * Base URL for the read API.
 *  - dev: empty string -> requests hit "/api/..." which Vite proxies to the API.
 *  - prod: set VITE_API_BASE_URL to the API origin (e.g. https://meteo.example.com).
 * The API's CORS (API_CORS_ORIGINS) must allow this site's origin in production.
 */
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const BASE = RAW_BASE || '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `GET ${path} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  baseUrl: BASE,

  /** GET /towns — active, geocoded towns for the map. */
  async towns(signal?: AbortSignal): Promise<Town[]> {
    const r = await get<Envelope<Town>>('/towns?active=true&limit=1000', signal);
    return r.data;
  },

  /** GET /time-ranges — intra-day windows, ordered by sortOrder. */
  async timeRanges(signal?: AbortSignal): Promise<TimeRange[]> {
    const r = await get<Envelope<TimeRange>>('/time-ranges', signal);
    return [...r.data].sort((a, b) => a.sortOrder - b.sortOrder);
  },

  /**
   * GET /measurements for a single town + day + window.
   * Omitting `kind` returns both FORECAST and OBSERVATION rows in one call.
   * latestOnly keeps the most recent run per (source, date, window).
   */
  async measurements(
    params: {
      townId: number;
      date: string; // YYYY-MM-DD
      timeRangeId: number;
      kind?: MeasurementKind;
    },
    signal?: AbortSignal,
  ): Promise<Measurement[]> {
    const q = new URLSearchParams({
      townId: String(params.townId),
      from: params.date,
      to: params.date,
      timeRangeId: String(params.timeRangeId),
      latestOnly: 'true',
      limit: '200',
    });
    if (params.kind) q.set('kind', params.kind);
    const r = await get<Envelope<Measurement>>(`/measurements?${q}`, signal);
    return r.data;
  },
};
