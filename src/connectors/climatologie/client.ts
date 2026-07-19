import { HttpError, httpRequest } from '../../lib/http.js';
import { makeRateLimiter, noopRateLimiter, type RateLimiter } from '../../lib/ratelimit.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ connector: 'mf-climatologie' });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Station {
  /** 8-digit DDCCCNNN id; the API returns it as a zero-padded string. */
  id: string;
  nom: string;
  posteOuvert: boolean;
  typePoste: number;
  lat: number;
  lon: number;
  alt?: number;
}

export interface StationParametre {
  nom: string;
  dateDebut: string;
  dateFin: string;
}

export interface StationInfo {
  id: number;
  nom: string;
  parametres: StationParametre[];
}

export interface ClimClientOptions {
  baseUrl: string;
  apiKey?: string;
  maxReqPerMin?: number;
  /** How long to keep polling /commande/fichier before giving up (ms). */
  downloadTimeoutMs?: number;
  /** Delay between download polls / before the first poll (ms). */
  pollIntervalMs?: number;
}

/** Signals a DPClim order for a period that holds no measurements (500 / no data). */
export class NoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoDataError';
  }
}

/** Thin HTTP client for the Météo-France Données Climatologiques (DPClim) API. */
export class ClimatologieClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly rate: RateLimiter;
  private readonly downloadTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(opts: ClimClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.rate = opts.maxReqPerMin ? makeRateLimiter(opts.maxReqPerMin) : noopRateLimiter;
    this.downloadTimeoutMs = opts.downloadTimeoutMs ?? 60_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  }

  private get auth() {
    return this.apiKey ? { apiKey: this.apiKey } : undefined;
  }

  async listeStationsHoraire(departement: number): Promise<Station[]> {
    await this.rate.acquire();
    const res = await httpRequest(`${this.baseUrl}/liste-stations/horaire`, {
      query: { 'id-departement': String(departement) },
      auth: this.auth,
      accept: 'application/json',
    });
    return (await res.json()) as Station[];
  }

  async informationStation(idStation: string): Promise<StationInfo | null> {
    await this.rate.acquire();
    const res = await httpRequest(`${this.baseUrl}/information-station`, {
      query: { 'id-station': idStation },
      auth: this.auth,
      accept: 'application/json',
    });
    const json = (await res.json()) as StationInfo[] | StationInfo;
    return Array.isArray(json) ? json[0] ?? null : json;
  }

  /**
   * Place an hourly archive order. Dates are ISO 8601 UTC (`...T00:00:00Z`).
   * Returns the order id (`elaboreProduitAvecDemandeResponse.return`). A 500
   * "production en échec" means the period holds no data → NoDataError.
   */
  async commandeHoraire(idStation: string, debut: Date, fin: Date): Promise<string> {
    await this.rate.acquire();
    try {
      const res = await httpRequest(`${this.baseUrl}/commande-station/horaire`, {
        query: {
          'id-station': idStation,
          'date-deb-periode': isoUtc(debut),
          'date-fin-periode': isoUtc(fin),
        },
        auth: this.auth,
        accept: 'application/json',
        maxRetries: 1,
      });
      const json = (await res.json()) as {
        elaboreProduitAvecDemandeResponse?: { return?: string | number };
      };
      const id = json.elaboreProduitAvecDemandeResponse?.return;
      if (id === undefined || id === null) {
        throw new Error('DPClim commande: missing order id in response');
      }
      return String(id);
    } catch (err) {
      if (err instanceof HttpError && err.status === 500 && isNoData(err.bodySnippet)) {
        throw new NoDataError(`no data for station ${idStation} over the requested period`);
      }
      throw err;
    }
  }

  /**
   * Poll /commande/fichier for a placed order: 201 = CSV ready, 204 = not ready
   * yet (retry). Times out after `downloadTimeoutMs`.
   */
  async telechargerCommande(idCmde: string): Promise<string> {
    const deadline = Date.now() + this.downloadTimeoutMs;
    await sleep(this.pollIntervalMs); // give the backend time to elaborate the file
    for (;;) {
      await this.rate.acquire();
      let res: Response;
      try {
        res = await httpRequest(`${this.baseUrl}/commande/fichier`, {
          query: { 'id-cmde': idCmde },
          auth: this.auth,
          accept: 'text/csv',
          maxRetries: 1,
        });
      } catch (err) {
        if (err instanceof HttpError && err.status === 500 && isNoData(err.bodySnippet)) {
          throw new NoDataError(`order ${idCmde}: production failed (no data)`);
        }
        throw err;
      }
      if (res.status === 201) return await res.text();
      // 204: not ready yet.
      if (Date.now() >= deadline) {
        throw new Error(`DPClim download timed out for order ${idCmde}`);
      }
      log.debug('order not ready, polling', { idCmde });
      await sleep(this.pollIntervalMs);
    }
  }
}

function isoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isNoData(snippet?: string): boolean {
  if (!snippet) return false;
  const s = snippet.toLowerCase();
  return s.includes("plage d'absence") || s.includes('absence de don') || s.includes('production en échec');
}
