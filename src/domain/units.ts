/** Canonical unit conversions used by connectors. */

export const KELVIN_OFFSET = 273.15;

export function kelvinToCelsius(k: number): number {
  return k - KELVIN_OFFSET;
}

/**
 * Convert a 2 m temperature reading to Celsius, tolerating either unit.
 * The AROME model is Kelvin, but Météo-France's WCS GeoTIFF export sometimes
 * already returns Celsius. No real near-surface air temperature falls between
 * 100 and 173, so we can safely treat values > 100 as Kelvin.
 */
export function toCelsius(raw: number): number {
  return raw > 100 ? raw - KELVIN_OFFSET : raw;
}

/** Cloud cover sometimes arrives as a 0..1 fraction; normalize to 0..100 %. */
export function toPercent(value: number): number {
  return value <= 1 ? value * 100 : value;
}

/** Precipitation from kg/m^2 is numerically equal to mm; identity helper for clarity. */
export function kgm2ToMm(value: number): number {
  return value;
}
