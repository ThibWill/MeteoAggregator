import type { ParamKey } from '../types.js';

/**
 * Mapping from our logical params to AROME WCS coverage naming. A coverage id
 * looks like `<PARAM>__<LEVEL>___<RUN_ISO>` (double underscore between param and
 * level, triple before the run reference time). We match on the `<PARAM>__<LEVEL>`
 * portion so e.g. WIND_SPEED does not accidentally match WIND_SPEED_GUST.
 *
 * Accumulated fields (precipitation) additionally carry a `_PT<N>H`/`_P<N>D`
 * accumulation-period suffix on the run token, and are published as one coverage
 * per period. We select `PT1H` (per-hour accumulation), so each time-step value
 * is that hour's precip in mm and a window total is just their sum.
 */
export interface AromeParamConfig {
  key: ParamKey;
  /** The `<PARAM>__<LEVEL>` string, matched against the coverage id prefix. */
  coverageParamLevel: string;
  /** Match by prefix instead of exact equality (for params with variable level suffixes). */
  matchPrefix?: boolean;
  /** Height subset required by this coverage, in metres, if any. */
  heightMeters?: number;
  /** Required accumulation period (e.g. `PT1H`) for accumulated fields; null for instantaneous. */
  accumulationPeriod?: string;
  /** Source unit → canonical conversion hint (applied in connector). */
  unit: 'kelvin' | 'percent' | 'fraction_or_percent' | 'kgm2' | 'ms' | 'jkg';
}

export const AROME_PARAMS: Record<ParamKey, AromeParamConfig> = {
  precipitation_mm: {
    key: 'precipitation_mm',
    coverageParamLevel: 'TOTAL_PRECIPITATION__GROUND_OR_WATER_SURFACE',
    accumulationPeriod: 'PT1H',
    unit: 'kgm2',
  },
  cloud_cover_pct: {
    key: 'cloud_cover_pct',
    coverageParamLevel: 'TOTAL_CLOUD_COVER__GROUND_OR_WATER_SURFACE',
    unit: 'fraction_or_percent',
  },
  temperature_c: {
    key: 'temperature_c',
    coverageParamLevel: 'TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND',
    heightMeters: 2,
    unit: 'kelvin',
  },
  wind_speed_ms: {
    key: 'wind_speed_ms',
    coverageParamLevel: 'WIND_SPEED__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND',
    heightMeters: 10,
    unit: 'ms',
  },
  wind_gust_ms: {
    key: 'wind_gust_ms',
    coverageParamLevel: 'WIND_SPEED_GUST__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND',
    heightMeters: 10,
    unit: 'ms',
  },
  cape_jkg: {
    key: 'cape_jkg',
    coverageParamLevel: 'CONVECTIVE_AVAILABLE_POTENTIAL_ENERGY__',
    matchPrefix: true,
    unit: 'jkg',
  },
};

/** Given a coverage's `<PARAM>__<LEVEL>` prefix, find which logical param it is. */
export function matchParam(coverageParamLevel: string): ParamKey | null {
  for (const cfg of Object.values(AROME_PARAMS)) {
    if (cfg.matchPrefix) {
      if (coverageParamLevel.startsWith(cfg.coverageParamLevel)) return cfg.key;
    } else if (coverageParamLevel === cfg.coverageParamLevel) {
      return cfg.key;
    }
  }
  return null;
}
