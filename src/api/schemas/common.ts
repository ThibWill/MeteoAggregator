import { z } from 'zod';
import { DateTime } from 'luxon';

export const MAX_PAGE_SIZE = 1000;
export const DEFAULT_PAGE_SIZE = 100;
/** Longest period a measurement query may span (§5.3). */
export const MAX_PERIOD_DAYS = 400;
export const DEFAULT_PERIOD_DAYS = 7;

export const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid, 'not a valid date');

/** Accepts `true/false/1/0`; `z.coerce.boolean()` would make "false" true. */
export const BoolParam = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** A query param that may appear once or repeatedly, normalized to an array. */
export function repeatable<T extends z.ZodTypeAny>(item: T) {
  return z
    .union([item, z.array(item)])
    .optional()
    .transform((v): z.infer<T>[] | undefined =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v],
    );
}

export const IntParam = z.coerce.number().int();
export const PositiveIntParam = z.coerce.number().int().positive();

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export const PeriodQuery = z.object({
  from: DateOnly.optional(),
  to: DateOnly.optional(),
});

export const MetaSchema = z.object({
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/** `{ data, meta }` envelope for every collection endpoint (§5.1). */
export function envelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), meta: MetaSchema });
}

export const ErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'BAD_REQUEST',
      'NOT_FOUND',
      'CONFLICT',
      'FORBIDDEN',
      'SERVICE_UNAVAILABLE',
      'INTERNAL',
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const MeasurementKindEnum = z.enum(['FORECAST', 'OBSERVATION']);
export const SourceKindEnum = z.enum(['FORECAST', 'OBSERVATION']);
export const WeatherCategoryEnum = z.enum([
  'CLEAR',
  'PARTLY_CLOUDY',
  'CLOUDY',
  'FOGGY',
  'RAINY',
  'HEAVY_RAIN',
  'SNOWY',
  'STORMY',
]);
export const PrecipLevelEnum = z.enum(['NONE', 'LIGHT', 'MODERATE', 'HEAVY']);
export const ReportStatusEnum = z.enum(['PENDING', 'SUCCESS', 'PARTIAL', 'FAILED']);

/** The standard error responses every route documents. */
export const errorResponses = {
  400: ErrorSchema,
  404: ErrorSchema,
  500: ErrorSchema,
} as const;
