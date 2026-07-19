import { logger } from '../../lib/logger.js';
import type {
  FetchObservationsOptions,
  ForecastSample,
  GeoPoint,
  ObservationConnector,
} from '../types.js';

/**
 * Stub observation connector.
 *
 * TODO: replace with a real source of observed/analysis values, e.g.:
 *   - Meteo-France observation API (SYNOP / station data), or
 *   - the AROME analysis / hour-0 field as an "actual" approximation, or
 *   - physical sensors.
 *
 * The daily task tolerates an empty observation result, so this returns `[]`
 * and the orchestrator simply writes no OBSERVATION rows until this is real.
 */
export class ObservationStubConnector implements ObservationConnector {
  readonly code = 'observation-stub';

  async fetchObservations(
    _point: GeoPoint,
    day: Date,
    _opts: FetchObservationsOptions,
  ): Promise<ForecastSample[]> {
    logger.debug('observation stub: returning no samples', {
      code: this.code,
      day: day.toISOString(),
    });
    return [];
  }

  async fetchObservationsRange(
    _point: GeoPoint,
    _from: Date,
    _to: Date,
    _opts: FetchObservationsOptions,
  ): Promise<ForecastSample[]> {
    return [];
  }
}
