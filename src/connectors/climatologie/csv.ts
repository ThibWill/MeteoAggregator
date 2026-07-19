import type { ForecastSample, ParamKey } from '../types.js';

/**
 * Parse a DPClim hourly "tous paramètres" CSV (`;`-separated) into per-hour
 * samples in canonical units. Columns are located by header name (their order
 * varies), so only the ones we map need to exist.
 *
 * Source columns (hourly, UTC), verified against the DPClim archive:
 *   RR1 = precipitation of the hour (mm) — already per-step, like AROME PT1H
 *   T   = air temperature (°C)
 *   FF  = mean 10-min wind (m/s)
 *   FXI = max gust (m/s); FXY used as fallback when FXI is absent
 *   N   = total cloud cover in OCTAS (0..8); 9 = sky not visible → ignored
 * `DATE` is `AAAAMMJJHH` (year-month-day-hour) in UTC. Empty cells = missing →
 * the param is omitted (never coerced to 0). Decimal comma tolerated.
 */
export function parseHourlyCsv(csv: string): ForecastSample[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined || lines.length < 2) return [];

  const header = headerLine.split(';').map((h) => h.trim().toUpperCase());
  const col = new Map<string, number>();
  header.forEach((name, i) => col.set(name, i));

  const dateIdx = col.get('DATE');
  if (dateIdx === undefined) return [];
  const gustIdx = col.get('FXI') ?? col.get('FXY');

  const samples: ForecastSample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(';');
    const validTime = parseHourlyDate(cells[dateIdx]?.trim());
    if (!validTime) continue;

    const params: Partial<Record<ParamKey, number>> = {};
    const rr1 = num(cells[col.get('RR1') ?? -1]);
    if (rr1 !== null) params.precipitation_mm = rr1;
    const t = num(cells[col.get('T') ?? -1]);
    if (t !== null) params.temperature_c = t;
    const ff = num(cells[col.get('FF') ?? -1]);
    if (ff !== null) params.wind_speed_ms = ff;
    const gust = gustIdx !== undefined ? num(cells[gustIdx]) : null;
    if (gust !== null) params.wind_gust_ms = gust;
    const n = num(cells[col.get('N') ?? -1]);
    if (n !== null && n <= 8) params.cloud_cover_pct = (n / 8) * 100;

    samples.push({ validTime, referenceTime: validTime, params });
  }
  return samples;
}

function num(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const v = cell.trim().replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `AAAAMMJJHH` (UTC) → Date. */
function parseHourlyDate(s: string | undefined): Date | null {
  if (!s || !/^\d{10}$/.test(s)) return null;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  const hour = Number(s.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day, hour));
}
