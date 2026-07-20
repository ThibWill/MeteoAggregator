/**
 * `@db.Date` columns come back as a Date at UTC midnight; formatting them with
 * anything local-timezone-aware shifts them by a day. Always slice the ISO
 * string (§5.6).
 */
export function dateOnly(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}

/** Timestamptz -> full ISO-8601 with `Z`. */
export function instant(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : v.toISOString();
}

/** Prisma Decimal / raw-query BigInt -> Number. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

/** Same as `num`, for counts that must not be null. */
export function count(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}
