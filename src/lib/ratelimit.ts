/**
 * Token-bucket rate limiter. Meteo-France API keys are tiered (e.g. 50 req/min);
 * exceeding the tier returns HTTP 429. This gates outbound calls so we stay
 * under the per-minute budget regardless of concurrency.
 */
export interface RateLimiter {
  acquire(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeRateLimiter(perMinute: number): RateLimiter {
  const capacity = Math.max(1, perMinute);
  const refillPerMs = capacity / 60_000;
  let tokens = capacity;
  let last = Date.now();

  return {
    async acquire(): Promise<void> {
      for (;;) {
        const now = Date.now();
        tokens = Math.min(capacity, tokens + (now - last) * refillPerMs);
        last = now;
        if (tokens >= 1) {
          tokens -= 1;
          return;
        }
        // Wait for enough tokens to accrue for one request.
        const needed = (1 - tokens) / refillPerMs;
        await sleep(Math.max(25, Math.ceil(needed)));
      }
    },
  };
}

/** A no-op limiter (for tests / unlimited tiers). */
export const noopRateLimiter: RateLimiter = { async acquire() {} };
