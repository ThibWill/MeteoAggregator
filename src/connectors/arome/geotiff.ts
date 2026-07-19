import { fromArrayBuffer } from 'geotiff';
import type { GeoPoint } from '../types.js';

export interface PixelReadResult {
  value: number | null;
  /** Pixel coordinates used, for provenance. */
  pixel: { x: number; y: number };
  bbox: [number, number, number, number];
  width: number;
  height: number;
  nodata: number | null;
}

/**
 * Read the numeric value nearest to `point` from a single-band GeoTIFF
 * (as returned by a WCS GetCoverage). Handles nodata/fill values.
 */
export async function readPointValue(
  buffer: ArrayBuffer,
  point: GeoPoint,
): Promise<PixelReadResult> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [minX, minY, maxX, maxY] = image.getBoundingBox() as [number, number, number, number];

  // Map lon/lat to fractional pixel coordinates. GeoTIFF origin is top-left,
  // so y increases downward while latitude decreases downward.
  const fx = ((point.lon - minX) / (maxX - minX)) * width;
  const fy = ((maxY - point.lat) / (maxY - minY)) * height;
  const x = clamp(Math.floor(fx), 0, width - 1);
  const y = clamp(Math.floor(fy), 0, height - 1);

  const nodata = parseNodata(image.getGDALNoData?.());

  const rasters = await image.readRasters({
    window: [x, y, x + 1, y + 1],
    width: 1,
    height: 1,
  });
  const band = rasters[0] as ArrayLike<number> | undefined;
  let value: number | null = band && band.length > 0 ? Number(band[0]) : null;
  if (value !== null && (Number.isNaN(value) || (nodata !== null && value === nodata))) {
    value = null;
  }

  return { value, pixel: { x, y }, bbox: [minX, minY, maxX, maxY], width, height, nodata };
}

function parseNodata(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isNaN(n) ? null : n;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
