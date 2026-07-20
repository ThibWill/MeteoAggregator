// Types mirror the API's Zod schemas (src/api/schemas/*). Kept hand-written so
// the front end has no build-time dependency on the server package.

export type MeasurementKind = 'FORECAST' | 'OBSERVATION';

export type WeatherCategory =
  | 'CLEAR'
  | 'PARTLY_CLOUDY'
  | 'CLOUDY'
  | 'FOGGY'
  | 'RAINY'
  | 'HEAVY_RAIN'
  | 'SNOWY'
  | 'STORMY';

export type PrecipLevel = 'NONE' | 'LIGHT' | 'MODERATE' | 'HEAVY';

export interface Meta {
  total: number;
  limit: number;
  offset: number;
}

export interface Envelope<T> {
  data: T[];
  meta: Meta;
}

export interface Town {
  id: number;
  name: string;
  country: string;
  adminArea: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  active: boolean;
  geocodedAt: string | null;
}

export interface TimeRange {
  id: number;
  code: string | null;
  startMinute: number;
  endMinute: number;
  sortOrder: number;
  /** Derived "07:00–13:00" label from the API. */
  label: string;
}

export interface MeasurementValues {
  precipitationMm: number | null;
  cloudCoverPct: number | null;
  temperatureC: number | null;
  windSpeedMs: number | null;
  windGustMs: number | null;
  capeJkg: number | null;
}

export interface Measurement {
  id: number;
  kind: MeasurementKind;
  townId: number;
  sourceId: number;
  sourceCode: string;
  targetDate: string;
  timeRangeId: number;
  timeRangeCode: string | null;
  referenceTime: string | null;
  runDate: string | null;
  leadDays: number | null;
  values: MeasurementValues;
  category: WeatherCategory;
  precipLevel: PrecipLevel;
  raw?: unknown;
}
