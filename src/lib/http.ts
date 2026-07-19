import { loadEnv } from '../config/env.js';
import { logger } from './logger.js';

export interface HttpAuth {
  /** Injected as the `apikey` header (Meteo-France public API convention). */
  apiKey?: string;
  /** Injected as `Authorization: Bearer <token>` if the API is switched to OAuth2. */
  bearerToken?: string;
}

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Query params appended to the URL. Values may repeat (arrays) — needed for WCS `subset`. */
  query?: Record<string, string | string[] | undefined>;
  body?: string | Uint8Array;
  auth?: HttpAuth;
  timeoutMs?: number;
  maxRetries?: number;
  /** Accept header override, e.g. `image/tiff`. */
  accept?: string;
  signal?: AbortSignal;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function buildUrl(base: string, query?: HttpOptions['query']): string {
  const url = new URL(base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) url.searchParams.append(key, v);
    }
  }
  return url.toString();
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 15_000);
  const jitter = Math.random() * base * 0.25;
  return base + jitter;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Single injection point for outbound HTTP: auth headers, timeout, and
 * exponential-backoff retry on transient failures. Returns the raw `Response`
 * so callers can read text (XML) or arrayBuffer (GeoTIFF).
 */
export async function httpRequest(base: string, opts: HttpOptions = {}): Promise<Response> {
  const env = safeEnv();
  const maxRetries = opts.maxRetries ?? env.maxRetries;
  const timeoutMs = opts.timeoutMs ?? env.timeoutMs;
  const url = buildUrl(base, opts.query);

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.accept) headers['Accept'] = opts.accept;
  const auth = opts.auth ?? {};
  if (auth.apiKey) headers['apikey'] = auth.apiKey;
  if (auth.bearerToken) headers['Authorization'] = `Bearer ${auth.bearerToken}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = mergeSignals(controller.signal, opts.signal);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body,
        signal,
      });
      if (res.ok) return res;

      if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
        const wait = retryAfterMs(res) ?? backoffMs(attempt);
        logger.warn('http retryable status, backing off', {
          url: redact(url),
          status: res.status,
          attempt,
          waitMs: Math.round(wait),
        });
        await sleep(wait);
        continue;
      }
      const snippet = await safeSnippet(res);
      throw new HttpError(
        `HTTP ${res.status} for ${redact(url)}`,
        res.status,
        redact(url),
        snippet,
      );
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError) throw err;
      // network/abort error — retry if attempts remain
      if (attempt < maxRetries) {
        const wait = backoffMs(attempt);
        logger.warn('http request failed, backing off', {
          url: redact(url),
          attempt,
          waitMs: Math.round(wait),
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(wait);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`http request failed for ${redact(url)}`);
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(h);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function safeSnippet(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return undefined;
  }
}

/** Strip the apikey query param if a caller ever puts it in the URL. */
function redact(url: string): string {
  return url.replace(/([?&])(apikey|token)=[^&]*/gi, '$1$2=***');
}

function mergeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  return ctrl.signal;
}

function safeEnv(): { maxRetries: number; timeoutMs: number } {
  try {
    const e = loadEnv();
    return { maxRetries: e.HTTP_MAX_RETRIES, timeoutMs: e.HTTP_TIMEOUT_MS };
  } catch {
    return { maxRetries: 3, timeoutMs: 30_000 };
  }
}
