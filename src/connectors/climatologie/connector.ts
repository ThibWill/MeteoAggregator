import { DateTime } from 'luxon';
import { prisma } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { geocodeDepartement } from '../../geocoding/geocoder.js';
import type {
  FetchObservationsOptions,
  ForecastSample,
  GeoPoint,
  ObservationConnector,
} from '../types.js';
import { ClimatologieClient, NoDataError, type StationInfo } from './client.js';
import { parseHourlyCsv } from './csv.js';
import { rankStations, stationIdToString } from './stations.js';

const log = logger.child({ connector: 'mf-climatologie' });

export interface ClimatologieConnectorOptions {
  baseUrl: string;
  apiKey?: string;
  maxReqPerMin?: number;
  downloadTimeoutMs?: number;
  pollIntervalMs?: number;
  /** How many ranked stations to probe for active sensors before falling back. */
  stationProbeLimit?: number;
}

interface StationMeta {
  id: string;
  nom: string;
  distanceKm: number;
  lat: number;
  lon: number;
  hasNebulosite: boolean;
}

export class ClimatologieObservationConnector implements ObservationConnector {
  readonly code = 'mf-climatologie';

  private readonly client: ClimatologieClient;
  private readonly stationProbeLimit: number;
  private readonly stationCache = new Map<string, string>();

  constructor(opts: ClimatologieConnectorOptions) {
    this.client = new ClimatologieClient(opts);
    this.stationProbeLimit = opts.stationProbeLimit ?? 5;
  }

  async fetchObservations(
    point: GeoPoint,
    day: Date,
    opts: FetchObservationsOptions,
  ): Promise<ForecastSample[]> {
    return this.fetchObservationsRange(point, day, day, opts);
  }

  async fetchObservationsRange(
    point: GeoPoint,
    from: Date,
    to: Date,
    opts: FetchObservationsOptions,
  ): Promise<ForecastSample[]> {
    const stationId = await this.resolveStation(point, opts);
    if (!stationId) {
      log.warn('no station resolved', { townName: opts.townName });
      return [];
    }
    const debut = DateTime.fromJSDate(from, { zone: 'utc' }).startOf('day').toJSDate();
    const fin = DateTime.fromJSDate(to, { zone: 'utc' }).endOf('day').toJSDate();
    try {
      const orderId = await this.client.commandeHoraire(stationId, debut, fin);
      const csv = await this.client.telechargerCommande(orderId);
      return parseHourlyCsv(csv);
    } catch (err) {
      if (err instanceof NoDataError) {
        log.warn('no data for period', {
          stationId,
          from: debut.toISOString(),
          to: fin.toISOString(),
        });
        return [];
      }
      throw err;
    }
  }

  /** Load the persisted town↔station mapping, resolving + saving it on first use. */
  private async resolveStation(
    point: GeoPoint,
    opts: FetchObservationsOptions,
  ): Promise<string | null> {
    const { townId, sourceId } = opts;
    if (townId === undefined || sourceId === undefined) {
      throw new Error('mf-climatologie: townId/sourceId required to resolve a station');
    }
    const cacheKey = `${townId}:${sourceId}`;
    const cached = this.stationCache.get(cacheKey);
    if (cached) return cached;

    const ts = await prisma.townSource.findUnique({
      where: { townId_sourceId: { townId, sourceId } },
    });
    if (ts?.stationId) {
      this.stationCache.set(cacheKey, ts.stationId);
      return ts.stationId;
    }

    const selected = await this.selectStation(point, opts.townName);
    if (!selected) return null;
    await prisma.townSource.update({
      where: { townId_sourceId: { townId, sourceId } },
      data: { stationId: selected.id, stationMeta: selected as never },
    });
    this.stationCache.set(cacheKey, selected.id);
    log.info('resolved station', { townName: opts.townName, ...selected });
    return selected.id;
  }

  private async selectStation(
    point: GeoPoint,
    townName?: string,
  ): Promise<StationMeta | null> {
    const dept = townName ? await geocodeDepartement({ name: townName }) : null;
    if (dept === null) {
      log.warn('could not resolve department', { townName });
      return null;
    }
    const stations = await this.client.listeStationsHoraire(dept);
    const ranked = rankStations(point, stations);
    if (ranked.length === 0) return null;

    // Probe the closest few for currently-active precip + temperature sensors,
    // preferring one that also measures cloud cover (nebulosité). Keep the first
    // precip+temp match as a backstop; fall back to the closest open station if
    // none qualifies.
    let backstop: StationMeta | null = null;
    for (const { station, distanceKm } of ranked.slice(0, this.stationProbeLimit)) {
      const id = stationIdToString(station.id);
      let info: StationInfo | null = null;
      try {
        info = await this.client.informationStation(id);
      } catch {
        info = null;
      }
      if (!info || !hasActive(info, 'PRECIPITATION') || !hasActive(info, 'TEMPERATURE')) {
        continue;
      }
      const meta: StationMeta = {
        id,
        nom: station.nom,
        distanceKm,
        lat: station.lat,
        lon: station.lon,
        hasNebulosite: hasActive(info, 'NEBULOSITE'),
      };
      if (meta.hasNebulosite) return meta;
      backstop ??= meta;
    }
    if (backstop) return backstop;
    const fallback = ranked[0]!;
    return {
      id: stationIdToString(fallback.station.id),
      nom: fallback.station.nom,
      distanceKm: fallback.distanceKm,
      lat: fallback.station.lat,
      lon: fallback.station.lon,
      hasNebulosite: false,
    };
  }
}

/** Does the station currently measure a parameter whose name contains `needle`? */
function hasActive(info: StationInfo, needle: string): boolean {
  return info.parametres.some(
    (p) => p.nom.toUpperCase().includes(needle) && (p.dateFin ?? '') === '',
  );
}
