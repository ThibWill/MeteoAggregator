import type { Measurement, MeasurementKind, TimeRange, WeatherCategory } from './types';

// ---- Weather category presentation ----
export const CATEGORY: Record<WeatherCategory, { label: string; color: string }> = {
  CLEAR: { label: 'Clear', color: '#f2b544' },
  PARTLY_CLOUDY: { label: 'Partly cloudy', color: '#7cc0ec' },
  CLOUDY: { label: 'Cloudy', color: '#9aabbd' },
  FOGGY: { label: 'Foggy', color: '#c2cbd4' },
  RAINY: { label: 'Rainy', color: '#4c93dd' },
  HEAVY_RAIN: { label: 'Heavy rain', color: '#2d63c4' },
  SNOWY: { label: 'Snowy', color: '#8fdcea' },
  STORMY: { label: 'Stormy', color: '#9366d6' },
};

export const SEVERITY: Record<WeatherCategory, number> = {
  CLEAR: 0,
  PARTLY_CLOUDY: 1,
  FOGGY: 1,
  CLOUDY: 2,
  RAINY: 3,
  SNOWY: 3,
  HEAVY_RAIN: 4,
  STORMY: 5,
};

// ---- Time-of-day theming, derived from a window's start/end minutes ----
export type PeriodKey = 'morning' | 'afternoon' | 'evening' | 'night';

const PERIOD_THEME: Record<PeriodKey, { accent: string; tint: string; label: string }> = {
  morning: { accent: '#f4a259', tint: 'rgba(255,196,140,0.30)', label: 'Morning' },
  afternoon: { accent: '#4ba3e8', tint: 'rgba(150,200,255,0.16)', label: 'Afternoon' },
  evening: { accent: '#ef7d57', tint: 'rgba(255,150,110,0.30)', label: 'Evening' },
  night: { accent: '#6b6fce', tint: 'rgba(40,44,104,0.34)', label: 'Night' },
};

export function periodKey(tr: TimeRange): PeriodKey {
  const end = tr.endMinute > tr.startMinute ? tr.endMinute : tr.endMinute + 1440;
  const mid = (((tr.startMinute + end) / 2) / 60) % 24;
  if (mid < 6) return 'night';
  if (mid < 12) return 'morning';
  if (mid < 17) return 'afternoon';
  if (mid < 21) return 'evening';
  return 'night';
}

export function periodTheme(tr: TimeRange) {
  const key = periodKey(tr);
  return { key, ...PERIOD_THEME[key], time: tr.label };
}

// ---- color utils ----
function hx(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export function blend(a: string, b: string, t: number): string {
  const x = hx(a);
  const y = hx(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export function rgba(hex: string, alpha: number): string {
  const c = hx(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

// ---- selecting one measurement per (town, kind) ----
export type RowsByTown = Record<number, Record<MeasurementKind, Measurement | null>>;

export function indexRows(townIds: number[], rows: Measurement[]): RowsByTown {
  const out: RowsByTown = {};
  for (const id of townIds) out[id] = { FORECAST: null, OBSERVATION: null };
  for (const m of rows) {
    const bucket = out[m.townId];
    if (bucket && !bucket[m.kind]) bucket[m.kind] = m;
  }
  return out;
}

// ---- formatting ----
export function fmt1(n: number | null): string {
  return n == null ? '—' : String(Math.round(n * 10) / 10);
}
export function round0(n: number | null): string {
  return n == null ? '—' : String(Math.round(n));
}
export function dateLabel(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
export function dateRel(iso: string): string {
  const a = new Date(iso + 'T00:00:00Z').getTime();
  const b = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  const d = Math.round((a - b) / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return d > 0 ? `D+${d}` : `D${d}`;
}
export function shiftDay(iso: string, delta: number): string {
  const dt = new Date(iso + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}
