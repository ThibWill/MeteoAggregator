import { loadEnv } from '../config/env.js';
import { AromeConnector } from './arome/connector.js';
import { ClimatologieObservationConnector } from './climatologie/connector.js';
import { ObservationStubConnector } from './observation/stub.js';
import type { ForecastConnector, ObservationConnector } from './types.js';

/**
 * Maps `source.code` → connector instance. New sources register here; the
 * orchestrator only ever looks a connector up by code.
 */
export class ConnectorRegistry {
  private forecast = new Map<string, ForecastConnector>();
  private observation = new Map<string, ObservationConnector>();

  registerForecast(c: ForecastConnector): void {
    this.forecast.set(c.code, c);
  }

  registerObservation(c: ObservationConnector): void {
    this.observation.set(c.code, c);
  }

  getForecast(code: string): ForecastConnector | undefined {
    return this.forecast.get(code);
  }

  getObservation(code: string): ObservationConnector | undefined {
    return this.observation.get(code);
  }
}

/** Build the default registry from environment config. */
export function buildDefaultRegistry(): ConnectorRegistry {
  const env = loadEnv();
  const registry = new ConnectorRegistry();
  registry.registerForecast(
    new AromeConnector({
      baseUrl: env.METEOFRANCE_BASE_URL,
      product: env.AROME_PRODUCT,
      apiKey: env.METEOFRANCE_API_KEY,
      maxHorizonDays: 2,
      maxReqPerMin: env.AROME_MAX_REQ_PER_MIN,
      stepHours: env.AROME_STEP_HOURS,
    }),
  );
  registry.registerObservation(new ObservationStubConnector());
  registry.registerObservation(
    new ClimatologieObservationConnector({
      baseUrl: env.METEOFRANCE_CLIM_BASE_URL,
      apiKey: env.METEOFRANCE_CLIMATOLOGY_API_KEY ?? env.METEOFRANCE_API_KEY,
      maxReqPerMin: env.CLIM_MAX_REQ_PER_MIN,
    }),
  );
  return registry;
}
