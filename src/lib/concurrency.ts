import pLimit from 'p-limit';
import { loadEnv } from '../config/env.js';

/**
 * A shared concurrency limiter for outbound HTTP so we stay polite to the
 * Meteo-France API (which rate-limits) and to the geocoder.
 */
export function makeLimiter(concurrency?: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const n = concurrency ?? safeConcurrency();
  const limit = pLimit(n);
  return (fn) => limit(fn);
}

function safeConcurrency(): number {
  try {
    return loadEnv().HTTP_CONCURRENCY;
  } catch {
    return 4;
  }
}
