# MeteoAggregator

Aggregate weather data from multiple sources into a database so that, over time,
we can **compare what was forecast (D-2 … D-0) against what actually happened**,
sliced by **city** and by **weather source**.

The first source is **Météo-France AROME 0025 (France)** via its public WCS
(OGC geospatial) API. The design is a connector pattern so adding sources is
additive, and sources are first-class rows in the database.

See [`PLAN.md`](./PLAN.md) for the full design rationale.

---

## Requirements

- Node.js ≥ 20
- Docker (for the PostgreSQL + PostGIS database)
- A Météo-France API key for live AROME fetches (optional for seeding / tests) —
  subscribe to the AROME API at <https://portail-api.meteofrance.fr/>.

## Quick start

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env
#    edit .env and set METEOFRANCE_API_KEY=... (only needed for `npm run daily`)

# 3. Start Postgres + PostGIS
npm run db:up

# 4. Apply the schema (pre-production: no migrations, just push + view)
npm run prisma:generate    # generate the Prisma client
npm run db:reset           # drop + apply schema.prisma + create the view

# 5. Seed sources, time ranges, and the 4 towns (geocoded on insert)
npm run seed

# 6. Run the daily aggregation once (needs METEOFRANCE_API_KEY)
npm run daily
```

## Commands

| Command | What it does |
|---|---|
| `npm test` | Run the unit tests (parsing, aggregation, categorization) — no DB/API needed. |
| `npm run typecheck` | Type-check the whole project. |
| `npm run db:up` / `npm run db:down` | Start / stop the Postgres+PostGIS container. |
| `npm run db:push` | Sync schema to the DB (non-destructive; no migrations). |
| `npm run db:reset` | Drop everything, re-apply `schema.prisma`, recreate the view. Wipes data. |
| `npm run db:reset:seed` | `db:reset` then re-seed. |
| `npm run prisma:generate` | Regenerate the Prisma client after schema changes. |
| `npm run seed` | Insert time ranges, sources, towns (geocoded), and town↔source links. Idempotent. |
| `npm run daily` | Run the orchestrator once (what cron calls). Idempotent. |
| `npm run geocode -- [--force]` | (Re)geocode towns missing coordinates (`--force` for all). |
| `npm run run-once -- --town=Lyon` | Run the orchestrator for a single town (debugging). |
| `npm run backfill:obs -- [--days=365] [--from=YYYY-MM-DD --to=…] [--town=Lyon]` | Backfill observations from the DPClim archive (one order per station over the span). |
| `npm run reliability -- [--window=7\|30\|365] [--town=Lyon] [--source=…] [--json]` | Forecast-vs-observed reliability stats per source × town × time range × lead day. |

> Note the `--` before script args (`npm run run-once -- --town=Lyon`).

## Configuration (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://meteo:meteo@localhost:5432/meteo?schema=public` | Postgres connection. |
| `METEOFRANCE_API_KEY` | — | AROME API key (injected as the `apikey` header). |
| `METEOFRANCE_BASE_URL` | `https://public-api.meteofrance.fr/public/arome/1.0` | AROME API base. |
| `AROME_PRODUCT` | `MF-NWP-HIGHRES-AROME-0025-FRANCE` | AROME product id. |
| `METEOFRANCE_CLIMATOLOGY_API_KEY` | — | DPClim (observations) key; separate subscription from AROME. Falls back to `METEOFRANCE_API_KEY`. |
| `METEOFRANCE_CLIM_BASE_URL` | `https://public-api.meteofrance.fr/public/DPClim/v1` | DPClim API base. |
| `CLIM_MAX_REQ_PER_MIN` | `45` | DPClim request budget (stay under the tier's rate limit). |
| `OBS_LOOKBACK_DAYS` | `3` | Daily run backfills observations for J-1 … J-N (the archive lags real time). |
| `GEOCODER_URL` | `https://api-adresse.data.gouv.fr/search/` | French BAN geocoder. |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org/search` | Fallback geocoder (non-FR). |
| `HTTP_CONCURRENCY` | `4` | Max concurrent outbound requests. |
| `HTTP_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `HTTP_MAX_RETRIES` | `3` | Retries on transient (429/5xx/network) failures. |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error`. |

## How it works

1. **AROME is a geospatial (WCS) API, not a "city → JSON" API.** The connector
   reads `GetCapabilities` to discover coverage ids (one physical parameter per
   model run), picks the **latest run** not in the future, `DescribeCoverage` to
   learn the axes / time steps, then `GetCoverage` to fetch a tiny GeoTIFF around
   each town centroid and reads the nearest pixel value.
2. Native hourly **samples** (in canonical units — °C, %, mm, m/s, J/kg) are
   bucketed by `domain/aggregate.ts` into the 4 configurable intra-day
   **time ranges** per *local* day (see Time zones). Precipitation (accumulated since run start) is
   **differenced** across each window; instantaneous fields are meaned/maxed.
3. `domain/categorize.ts` derives a **weather category** (clear … stormy) and a
   **precip level** from tunable thresholds (`config/thresholds.ts`). The raw
   numbers are always kept so categories can be recomputed historically.
4. Rows are upserted into `weather_measurement` (`kind = FORECAST`). Observed
   "actuals" go into the same table with `kind = OBSERVATION` — today via a
   documented **stub** connector that the task tolerates returning nothing.

### Comparison use case

The point of the schema is this query, available as the `forecast_vs_observed`
view: each forecast row (across lead times D-2/D-1/D-0) paired with the matching
observation for the same town / target date / time range.

```sql
SELECT * FROM forecast_vs_observed
WHERE town_id = (SELECT id FROM town WHERE name = 'Lyon')
  AND target_date = '2026-07-20'
ORDER BY time_range_id, lead_days;
```

## Time zones

Days and time-range windows are wall-clock **local**, not UTC, so `morning` /
`evening` mean what a resident would mean. Each town carries its own IANA zone
in `town.timezone`, falling back to the `TIME_ZONE` env default when null — so
towns in different countries can be tracked side by side. `start_minute` /
`end_minute` on `time_range` are offsets from *local* midnight, resolved as wall
clock, so windows keep their hours across the 23h/25h DST days.

`target_date` and `run_date` stay stored as `YYYY-MM-DDT00:00:00Z` markers: they
label a local calendar day, they are not instants.

## Cron

`npm run daily` is idempotent (unique constraints + upserts), so re-runs are
safe. Schedule it after AROME's early run is published, e.g. 05:10 UTC:

```cron
10 5 * * * cd /home/thibwill/MeteoAggregator && /usr/bin/env -S bash -lc 'npm run daily' >> logs/daily.log 2>&1
```

If cron's environment lacks your Node/npm on `PATH`, use absolute paths, e.g.:

```cron
10 5 * * * cd /home/thibwill/MeteoAggregator && /path/to/node ./node_modules/.bin/tsx src/cli/daily.ts >> logs/daily.log 2>&1
```

(Create the `logs/` directory first: `mkdir -p logs`.)

## Project layout

```
src/
  config/      env (zod) + tunable thresholds
  db/          prisma client singleton + repository helpers
  connectors/
    types.ts   source-agnostic connector contracts
    registry.ts
    arome/     capabilities, coverage (DescribeCoverage + subset builder),
               geotiff reader, params mapping, connector
    climatologie/ DPClim client, CSV parser, station selection, connector
    observation/ stub.ts (disabled)
  geocoding/   BAN + Nominatim geocoder (+ department resolver)
  domain/      timeRanges, aggregate, categorize, units, reliability
  tasks/       dailyRun orchestrator, observation writer
  cli/         seed, daily, geocode, runOnce, backfillObs, reliability
test/          fixtures + unit tests
prisma/        schema.prisma + migrations (incl. PostGIS + forecast_vs_observed view)
```

## Testing

```bash
npm test
```

Unit tests cover the deterministic core against fixtures: GetCapabilities /
DescribeCoverage parsing, run resolution, window aggregation (incl. accumulated
precip differencing), categorization thresholds, unit conversions, and time-range
math. They need neither the database nor the live API. Live-API integration is
gated behind having `METEOFRANCE_API_KEY` set (`npm run daily`).

## Extending

- **Add a forecast source** (e.g. Open-Meteo for D-3…D-7): implement
  `ForecastConnector`, register it in `connectors/registry.ts`, and add a
  `source` row (`kind = FORECAST`, `max_horizon_days = 7`). No schema change.
- **Observations**: the Météo-France DPClim archive is wired in
  (`connectors/climatologie/`, source `mf-climatologie`). It resolves the nearest
  open station per town (persisted on `town_source`), orders the hourly archive,
  and writes `kind = OBSERVATION` rows. It lags real time, so the daily run
  backfills J-1 … J-`OBS_LOOKBACK_DAYS`; `npm run backfill:obs` seeds history.
- **Re-cut time ranges**: edit the `time_range` rows — they store minute offsets,
  not names.
```
