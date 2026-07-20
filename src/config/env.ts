import 'dotenv/config';
import { IANAZone } from 'luxon';
import { z } from 'zod';

/**
 * Central, validated runtime configuration. Everything that reads from the
 * environment goes through here so the rest of the code depends on typed,
 * defaulted values rather than `process.env` directly.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),

  // Calendar days and time-range windows are wall-clock in this zone, so
  // "evening" means evening where the town is, not 19:00-24:00 UTC.
  TIME_ZONE: z
    .string()
    .default('Europe/Paris')
    .refine((z) => IANAZone.isValidZone(z), { message: 'must be a valid IANA time zone' }),

  METEOFRANCE_API_KEY: z.string().min(1).optional(),
  METEOFRANCE_BASE_URL: z
    .string()
    .url()
    .default('https://public-api.meteofrance.fr/public/arome/1.0'),
  AROME_PRODUCT: z.string().default('MF-NWP-HIGHRES-AROME-0025-FRANCE'),

  // Données Climatologiques (DPClim): observation archive. Needs its own
  // subscription on portail-api.meteofrance.fr — the AROME key gets 403 on
  // DPClim. Falls back to METEOFRANCE_API_KEY only if they share a key.
  METEOFRANCE_CLIMATOLOGY_API_KEY: z.string().min(1).optional(),
  METEOFRANCE_CLIM_BASE_URL: z
    .string()
    .url()
    .default('https://public-api.meteofrance.fr/public/DPClim/v1'),
  CLIM_MAX_REQ_PER_MIN: z.coerce.number().int().positive().default(45),
  // Observations are a qualified archive (not real time): write J-1..J-N.
  OBS_LOOKBACK_DAYS: z.coerce.number().int().min(1).default(3),

  GEOCODER_URL: z.string().url().default('https://api-adresse.data.gouv.fr/search/'),
  NOMINATIM_URL: z
    .string()
    .url()
    .default('https://nominatim.openstreetmap.org/search'),

  HTTP_CONCURRENCY: z.coerce.number().int().positive().default(4),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  HTTP_MAX_RETRIES: z.coerce.number().int().min(0).default(3),

  // AROME key tier: requests/minute budget (public tier is often 50/min).
  AROME_MAX_REQ_PER_MIN: z.coerce.number().int().positive().default(45),
  // Sample every Nth hourly step (1 = every step). Higher = fewer requests.
  AROME_STEP_HOURS: z.coerce.number().int().positive().default(1),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // --- Read API (src/api) ---
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  // Comma-separated origin list; '*' only for dev.
  API_CORS_ORIGINS: z.string().default('*'),
  API_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(1000),
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
  // z.coerce.boolean() makes any non-empty string true, so parse explicitly.
  API_ENABLE_ADMIN: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test/reset hook. */
export function resetEnvCache(): void {
  cached = null;
}
