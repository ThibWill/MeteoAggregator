import { upsertMeasurement } from '../db/repo.js';
import type { ForecastSample } from '../connectors/types.js';
import { aggregate } from '../domain/aggregate.js';
import { categorize } from '../domain/categorize.js';
import {
  appTimeZone,
  dateMarker,
  rangeBounds,
  type TimeRangeDef,
} from '../domain/timeRanges.js';

export interface WriteObservationParams {
  obsSourceId: number;
  townId: number;
  /** Local target dates (`YYYY-MM-DD`) to materialize from `samples`. */
  dayKeys: string[];
  samples: ForecastSample[];
  timeRanges: TimeRangeDef[];
  zone?: string;
}

/**
 * Aggregate observed hourly samples into (day x time_range) OBSERVATION rows.
 * `referenceTime` is the window start (existing convention), so the natural key
 * stays stable and re-runs upsert in place. Returns the number of rows written.
 */
export async function writeObservationSamples(params: WriteObservationParams): Promise<number> {
  const { obsSourceId, townId, dayKeys, samples, timeRanges } = params;
  const zone = params.zone ?? appTimeZone();
  let written = 0;
  for (const dayKey of dayKeys) {
    const targetDate = dateMarker(dayKey);
    for (const range of timeRanges) {
      const agg = aggregate(samples, dayKey, range, zone);
      if (!agg) continue;
      const cat = categorize(agg);
      const windowStart = rangeBounds(dayKey, range, zone).start;
      await upsertMeasurement({
        reportId: null,
        townId,
        sourceId: obsSourceId,
        kind: 'OBSERVATION',
        targetDate,
        timeRangeId: range.id,
        referenceTime: windowStart,
        runDate: targetDate,
        leadDays: 0,
        values: {
          precipitationMm: agg.precipitationMm,
          cloudCoverPct: agg.cloudCoverPct,
          temperatureC: agg.temperatureC,
          windSpeedMs: agg.windSpeedMs,
          windGustMs: agg.windGustMs,
          capeJkg: agg.capeJkg,
        },
        category: cat.category,
        precipLevel: cat.precipLevel,
        raw: agg.raw as never,
      });
      written++;
    }
  }
  return written;
}
