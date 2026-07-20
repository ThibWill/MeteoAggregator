import type { Measurement } from './types';
import { blend, CATEGORY, rgba, SEVERITY } from './weather';

interface MarkerOpts {
  townName: string;
  row: Measurement | null;
  accent: string;
  selected: boolean;
  dark: boolean;
  animate: boolean;
}

/** Returns { size, html } for a Leaflet divIcon representing one town. */
export function buildMarker({ townName, row, accent, selected, dark, animate }: MarkerOpts): {
  size: number;
  html: string;
} {
  const textColor = dark ? '#eaf0f8' : '#16202e';
  const shadow = dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';

  if (!row) {
    const size = 64;
    const ring = selected ? `<div class="wm-ring" style="width:32px;height:32px;border-style:dashed;"></div>` : '';
    return {
      size,
      html: `<div class="wm-marker">${ring}
        <div class="wm-core" style="background:transparent;border:2px dashed ${dark ? 'rgba(255,255,255,0.45)' : 'rgba(20,30,50,0.32)'};box-shadow:none;"></div>
        <div class="wm-label" style="color:${textColor};text-shadow:0 1px 3px ${shadow};">
          <span class="wm-temp" style="opacity:0.45;">—</span>
          <span class="wm-name">${townName}</span>
        </div></div>`,
    };
  }

  const v = row.values;
  const cat = CATEGORY[row.category] ?? CATEGORY.CLOUDY;
  const sev = SEVERITY[row.category] ?? 0;
  const precip = v.precipitationMm ?? 0;
  const size = Math.min(190, 92 + sev * 16 + Math.min(precip, 10) * 3);
  const color = blend(cat.color, accent, 0.22);
  const pulse = animate ? 'wm-pulse' : '';
  const glow = dark ? 0.55 : 0.4;
  const mid = dark ? 0.3 : 0.22;
  const temp = v.temperatureC != null ? `${Math.round(v.temperatureC)}°` : '—';
  const ring = selected ? `<div class="wm-ring" style="width:${size * 0.34}px;height:${size * 0.34}px;"></div>` : '';

  return {
    size,
    html: `<div class="wm-marker">
      <div class="wm-aura ${pulse}" style="width:${size}px;height:${size}px;background:radial-gradient(circle, ${rgba(color, glow)} 0%, ${rgba(color, mid)} 42%, ${rgba(color, 0)} 70%);"></div>
      ${ring}
      <div class="wm-core" style="background:${color};"></div>
      <div class="wm-label" style="color:${textColor};text-shadow:0 1px 3px ${shadow};">
        <span class="wm-temp">${temp}</span>
        <span class="wm-name">${townName}</span>
      </div></div>`,
  };
}
