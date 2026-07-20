import { upsertMeasurement } from '../db/repo.js';
import type { ForecastSample } from '../connectors/types.js';
import { aggregate, expectedSteps } from '../domain/aggregate.js';
import { categorize } from '../domain/categorize.js';
import {
  appTimeZone,
  dateMarker,
  rangeBounds,
  type TimeRangeDef,
} from '../domain/timeRanges.js';

/** The DPClim archive is hourly. */
const OBS_STEP_MINUTES = 60;

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
      const bounds = rangeBounds(dayKey, range, zone);
      const agg = aggregate(samples, dayKey, range, zone);
      // Same rule as forecasts: an incomplete observed window is a biased
      // reference to score against, so skip it rather than half-fill it.
      if (!agg || agg.raw.stepCount < expectedSteps(bounds, OBS_STEP_MINUTES)) continue;
      const cat = categorize(agg);
      const windowStart = bounds.start;
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
        leadMinutes: 0,
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
