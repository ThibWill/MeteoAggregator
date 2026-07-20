import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { api } from './api';
import { useWeatherData } from './useWeatherData';
import { buildMarker } from './markers';
import {
  CATEGORY,
  dateLabel,
  dateRel,
  fmt1,
  periodTheme,
  rgba,
  round0,
  shiftDay,
} from './weather';
import type { MeasurementKind, TimeRange } from './types';

const CARTO = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const KINDS: { code: MeasurementKind; label: string }[] = [
  { code: 'FORECAST', label: 'Forecast' },
  { code: 'OBSERVATION', label: 'Observed' },
];

export function WeatherMap() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [dateISO, setDateISO] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [kind, setKind] = useState<MeasurementKind>('FORECAST');
  const [selectedTownId, setSelectedTownId] = useState<number | null>(null);

  const { towns, timeRanges, rows, mode, loading, error } = useWeatherData(dateISO, periodId);
  const dark = theme === 'dark';
  const animate = true;

  // default selection once reference data arrives
  useEffect(() => {
    if (periodId == null && timeRanges.length) {
      const noon = timeRanges.find((r) => r.startMinute <= 780 && r.endMinute > 780);
      setPeriodId((noon ?? timeRanges[Math.floor(timeRanges.length / 2)] ?? timeRanges[0]).id);
    }
  }, [timeRanges, periodId]);
  useEffect(() => {
    if (selectedTownId == null && towns.length) setSelectedTownId(towns[0].id);
  }, [towns, selectedTownId]);

  const period = useMemo<TimeRange | null>(
    () => timeRanges.find((t) => t.id === periodId) ?? timeRanges[0] ?? null,
    [timeRanges, periodId],
  );
  const pTheme = useMemo(
    () => (period ? periodTheme(period) : { accent: '#4ba3e8', tint: 'rgba(150,200,255,0.16)', label: '', time: '' }),
    [period],
  );

  // ---- Leaflet map lifecycle ----
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: false, minZoom: 4, maxZoom: 11 }).setView([46.7, 2.4], 6);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    tilesRef.current = L.tileLayer(CARTO.light, {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '© OpenStreetMap · © CARTO',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // swap tiles on theme change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tilesRef.current) map.removeLayer(tilesRef.current);
    tilesRef.current = L.tileLayer(dark ? CARTO.dark : CARTO.light, {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '© OpenStreetMap · © CARTO',
    }).addTo(map);
  }, [dark]);

  // (re)draw markers
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const town of towns) {
      if (town.latitude == null || town.longitude == null) continue;
      const row = rows[town.id]?.[kind] ?? null;
      const { size, html } = buildMarker({
        townName: town.name,
        row,
        accent: pTheme.accent,
        selected: town.id === selectedTownId,
        dark,
        animate,
      });
      const icon = L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      L.marker([town.latitude, town.longitude], { icon, riseOnHover: true })
        .addTo(layer)
        .on('click', () => setSelectedTownId(town.id));
    }
  }, [towns, rows, kind, selectedTownId, pTheme.accent, dark]);

  // fly to selected town
  useEffect(() => {
    const map = mapRef.current;
    const town = towns.find((t) => t.id === selectedTownId);
    if (map && town && town.latitude != null && town.longitude != null) {
      map.flyTo([town.latitude, town.longitude], 7, { duration: 0.8 });
    }
  }, [selectedTownId, towns]);

  // ---- derived detail ----
  const selTown = towns.find((t) => t.id === selectedTownId) ?? null;
  const row = selTown ? rows[selTown.id]?.[kind] ?? null : null;
  const altRow = selTown ? rows[selTown.id]?.[kind === 'FORECAST' ? 'OBSERVATION' : 'FORECAST'] ?? null : null;
  const kindLabel = kind === 'FORECAST' ? 'Forecast' : 'Observed';

  const status = statusPill(mode, loading, rows, api.baseUrl);

  return (
    <div
      className="wm-root"
      data-theme={theme}
      style={{ ['--wm-accent' as string]: pTheme.accent }}
    >
      <div ref={mapEl} className="wm-map" />
      <div
        className="wm-overlay"
        style={{
          background: pTheme.tint,
          mixBlendMode: dark ? 'screen' : 'multiply',
        }}
      />

      {/* top bar */}
      <div className="wm-topbar">
        <div className="wm-panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 18 }}>
          <div style={{ width: 34, height: 34, borderRadius: 11, background: 'var(--wm-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 10px rgba(20,30,50,0.18)' }}>
            <div style={{ width: 13, height: 13, borderRadius: '50%', background: '#fff' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05 }}>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>Aria Météo</span>
            <span style={{ fontSize: 11, opacity: 0.55 }}>{status.subtitle}</span>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4, padding: '5px 10px', borderRadius: 999, background: status.bg, color: status.color, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            <span className={status.spin ? 'wm-spin' : undefined} style={{ width: 6, height: 6, borderRadius: '50%', background: status.color }} />
            {status.label}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* city */}
        <div className="wm-panel" style={{ position: 'relative', display: 'flex', alignItems: 'center', padding: '6px 10px 6px 14px', borderRadius: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.5, marginRight: 10 }}>City</span>
          <select
            value={selectedTownId ?? ''}
            onChange={(e) => setSelectedTownId(Number(e.target.value))}
            style={{ appearance: 'none', border: 'none', background: 'transparent', color: 'inherit', fontFamily: "'Figtree', sans-serif", fontSize: 14, fontWeight: 600, paddingRight: 20, cursor: 'pointer', outline: 'none' }}
          >
            {towns.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span style={{ position: 'absolute', right: 12, pointerEvents: 'none', opacity: 0.5, fontSize: 11 }}>▾</span>
        </div>

        {/* date */}
        <div className="wm-panel" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 6, borderRadius: 14 }}>
          <button className="wm-icon-btn" onClick={() => setDateISO((d) => shiftDay(d, -1))}>‹</button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 108, lineHeight: 1.1 }}>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 14 }}>{dateLabel(dateISO)}</span>
            <span style={{ fontSize: 10, opacity: 0.5 }}>{dateRel(dateISO)}</span>
          </div>
          <button className="wm-icon-btn" onClick={() => setDateISO((d) => shiftDay(d, 1))}>›</button>
        </div>

        {/* forecast / observed */}
        <div className="wm-panel" style={{ display: 'flex', gap: 3, padding: 5, borderRadius: 14 }}>
          {KINDS.map((k) => {
            const active = kind === k.code;
            return (
              <button
                key={k.code}
                className="wm-seg"
                onClick={() => setKind(k.code)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 11,
                  fontWeight: 600,
                  fontSize: 13,
                  background: active ? 'var(--wm-accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--wm-text)',
                  opacity: active ? 1 : 0.6,
                }}
              >
                {k.label}
              </button>
            );
          })}
        </div>

        {/* theme */}
        <button
          className="wm-panel wm-seg"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          style={{ width: 44, height: 44, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span style={{ fontSize: 15 }}>{dark ? '☾' : '☀'}</span>
        </button>
      </div>

      {/* period selector */}
      <div className="wm-panel" style={{ position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 20, display: 'flex', gap: 6, padding: 7, borderRadius: 20, boxShadow: '0 10px 40px rgba(20,30,50,0.16)' }}>
        {timeRanges.map((tr) => {
          const meta = periodTheme(tr);
          const active = tr.id === periodId;
          return (
            <button
              key={tr.id}
              className="wm-seg"
              onClick={() => setPeriodId(tr.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '9px 14px',
                borderRadius: 14,
                background: active ? meta.accent : 'transparent',
                color: active ? '#fff' : 'var(--wm-text)',
                opacity: active ? 1 : 0.72,
                boxShadow: active ? `0 4px 14px ${rgba(meta.accent, 0.4)}` : 'none',
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.accent }} />
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{meta.label}</span>
                <span style={{ fontSize: 10, opacity: 0.55, fontFamily: "'Space Grotesk', sans-serif" }}>{meta.time}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* detail card */}
      {selTown && (
        <div className="wm-panel" style={{ position: 'absolute', top: 92, left: 18, zIndex: 20, width: 320, padding: 22, borderRadius: 22, boxShadow: '0 16px 50px rgba(20,30,50,0.18)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5 }}>
                {pTheme.label} · {kindLabel}
              </div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 26, letterSpacing: '-0.01em', marginTop: 3 }}>{selTown.name}</div>
            </div>
            {(() => {
              const cat = row ? CATEGORY[row.category] : { label: 'No data', color: '#9aabbd' };
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, background: rgba(cat.color, 0.16), color: cat.color, fontSize: 12, fontWeight: 700 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color }} />
                  {cat.label}
                </span>
              );
            })()}
          </div>

          {row ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginTop: 16 }}>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 62, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{round0(row.values.temperatureC)}°</div>
                <div style={{ paddingBottom: 8, fontSize: 13, opacity: 0.7 }}>
                  <div>
                    {kind === 'FORECAST' ? 'Observed' : 'Forecast'}{' '}
                    <b style={{ opacity: 1 }}>{altRow?.values.temperatureC != null ? `${round0(altRow.values.temperatureC)}°` : 'no data'}</b>
                  </div>
                  {(() => {
                    const a = row.values.temperatureC;
                    const b = altRow?.values.temperatureC;
                    if (a == null || b == null) return <div style={{ color: '#8a93a0', fontWeight: 600 }}>—</div>;
                    const d = Math.round(a - b);
                    const color = d > 0 ? '#e0803a' : d < 0 ? '#4b8fd0' : '#8a93a0';
                    const text = d === 0 ? 'matches' : `${d > 0 ? '+' : ''}${d}° vs ${kind === 'FORECAST' ? 'observed' : 'forecast'}`;
                    return <div style={{ color, fontWeight: 600 }}>{text}</div>;
                  })()}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 18 }}>
                <Metric k="Precip" v={fmt1(row.values.precipitationMm)} u="mm" />
                <Metric k="Cloud" v={round0(row.values.cloudCoverPct)} u="%" />
                <Metric k="Wind" v={fmt1(row.values.windSpeedMs)} u="m/s" />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--wm-border)', fontSize: 11, opacity: 0.6 }}>
                <span>Gusts {fmt1(row.values.windGustMs)} m/s</span>
                <span>{[row.sourceCode, row.leadDays != null ? `D+${row.leadDays}` : null].filter(Boolean).join(' · ')}</span>
              </div>
            </>
          ) : (
            <div style={{ marginTop: 18, padding: 16, borderRadius: 14, background: 'var(--wm-tile)', fontSize: 13, opacity: 0.7, textAlign: 'center' }}>
              No {kindLabel} measurement for this window.
            </div>
          )}
        </div>
      )}

      {/* legend */}
      <div className="wm-panel" style={{ position: 'absolute', bottom: 22, right: 18, zIndex: 20, padding: '14px 16px', borderRadius: 18 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 9 }}>Conditions</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
          {Object.values(CATEGORY).map((c) => (
            <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
              {c.label}
            </div>
          ))}
        </div>
      </div>

      {error && mode === 'live' && (
        <div style={{ position: 'absolute', bottom: 88, left: '50%', transform: 'translateX(-50%)', zIndex: 25, padding: '8px 14px', borderRadius: 12, background: rgba('#d64545', 0.14), color: '#d64545', fontSize: 12, fontWeight: 600 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function Metric({ k, v, u }: { k: string; v: string; u: string }) {
  return (
    <div className="wm-tile">
      <div className="wm-tile-k">{k}</div>
      <div className="wm-tile-v">
        {v}
        <span className="wm-tile-u"> {u}</span>
      </div>
    </div>
  );
}

function statusPill(
  mode: 'loading' | 'live' | 'demo',
  loading: boolean,
  rows: Record<number, unknown>,
  baseUrl: string,
) {
  if (mode === 'loading' || (mode === 'live' && loading && !Object.keys(rows).length)) {
    return { label: 'Connecting', color: '#7c8698', bg: rgba('#7c8698', 0.16), spin: true, subtitle: 'Loading reference data…' };
  }
  if (mode === 'demo') {
    return { label: 'Demo', color: '#e0803a', bg: rgba('#e0803a', 0.16), spin: false, subtitle: 'API unreachable · sample data' };
  }
  return {
    label: loading ? 'Syncing' : 'Live',
    color: '#3ba55d',
    bg: rgba('#3ba55d', 0.16),
    spin: loading,
    subtitle: 'Live · ' + baseUrl.replace(/^https?:\/\//, ''),
  };
}
