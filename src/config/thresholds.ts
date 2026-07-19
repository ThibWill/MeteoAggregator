/**
 * Tunable thresholds for the categorization rule engine. Centralized here so
 * the derived `category` / `precip_level` can be re-cut without touching logic,
 * and so historical rows can be recomputed against a new ruleset.
 *
 * All precipitation thresholds are per time-range window accumulation (mm).
 */
export interface Thresholds {
  precip: {
    /** < light => NONE */
    light: number;
    /** < moderate => LIGHT */
    moderate: number;
    /** >= heavy => HEAVY, otherwise MODERATE */
    heavy: number;
  };
  cloud: {
    /** cloud cover % below this => CLEAR */
    clear: number;
    /** cloud cover % below this => PARTLY_CLOUDY, else CLOUDY */
    partly: number;
  };
  storm: {
    /** CAPE (J/kg) above this contributes to STORMY */
    capeJkg: number;
    /** gust (m/s) above this contributes to STORMY */
    gustMs: number;
  };
  /** at or below this 2 m temperature (°C), precipitation is treated as snow */
  snowTempC: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  precip: {
    light: 0.1,
    moderate: 2.5,
    heavy: 7.6,
  },
  cloud: {
    clear: 20,
    partly: 60,
  },
  storm: {
    capeJkg: 800,
    gustMs: 25,
  },
  snowTempC: 0.5,
};
