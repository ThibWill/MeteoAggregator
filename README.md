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
| `npm run api` | Start the read HTTP API (see below). |
| `npm run api:dev` | Same, with reload on change. |

> Note the `--` before script args (`npm run run-once -- --town=Lyon`).

## Read API

```bash
npm run api     # http://localhost:3000
```

Browse the interactive docs at **<http://localhost:3000/docs>**; the OpenAPI
document itself is at `/openapi.json` and is the contract a front end generates
its client from. Everything is UTC and ISO-8601: dates are `YYYY-MM-DD`,
instants end in `Z`.

| Endpoint | What it returns |
|---|---|
| `GET /health`, `GET /health/db` | Liveness, and readiness (`503` if Postgres is unreachable). |
| `GET /towns`, `GET /towns/:id` | Tracked towns; the detail adds source links and a `coverage` block (first/last target date + row count). |
| `GET /sources` | Weather sources. `config` is never exposed. |
| `GET /time-ranges` | Active intra-day windows, with a derived `"07:00–13:00"` label. |
| `GET /measurements` | The core endpoint: forecast + observation rows for **one town** over a period. |
| `GET /measurements/timeseries` | The same rows pivoted into chart-ready series. |
| `GET /comparison` | Forecast rows paired with their observed counterpart, with `delta` and match flags. |
| `GET /reliability` | Rolling 7d/30d/365d stats and the category confusion matrix. |
| `GET /reports`, `/reports/:id`, `/reports/summary` | Batch run history and per-day status counts. |
| `POST /admin/jobs/daily-run`, `POST /admin/jobs/backfill-observations`, `GET /admin/jobs[/:id]` | Trigger and follow the batch tasks. |

Conventions:

- Collections return `{ "data": [...], "meta": { total, limit, offset } }`;
  single resources return the object directly.
- `limit` defaults to 100, max 1000. Give `from`/`to` (inclusive) to pick a
  period — with neither, you get the **last 7 days**, never the whole archive.
  Measurement periods are capped at 400 days.
- `/measurements` **requires** a town (`?town=Lyon` or `?townId=1`) so a query
  can never scan every town. An unknown name is a `404`, not an empty list.
- `latestOnly=true` (the default) keeps only the most recent model run per
  (source, target date, time range). Pass `latestOnly=false` to see how a
  forecast changed as the target date approached.
- The bulky `raw` payload is omitted unless you ask for `?include=raw`.
- Errors always look like
  `{ "error": { "code": "BAD_REQUEST", "message": "...", "details": [...] } }`.

Examples:

```bash
curl 'localhost:3000/measurements?town=Lyon&from=2026-07-19&to=2026-07-21'
curl 'localhost:3000/measurements/timeseries?town=Lyon&sourceId=1&kind=FORECAST'
curl 'localhost:3000/reliability?town=Lyon&window=30d'
curl -X POST localhost:3000/admin/jobs/daily-run -H 'content-type: application/json' -d '{}'
```

> **The API has no authentication.** It is meant for a private network. The
> `/admin/*` triggers start real batch jobs, so do not publish port 3000 on a
> public interface — set `API_ENABLE_ADMIN=false` and put a proxy in front if
> you must. Job history is in-memory and lost on restart; the `report` table is
> the durable record.

In Docker, `docker compose up -d` now brings up **db + api** together (batch
tasks stay on demand under the `app` profile).

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
| `API_PORT` | `3000` | Port the read API listens on. |
| `API_HOST` | `0.0.0.0` | Bind address (so it is reachable inside the compose network; the **published port** decides exposure). |
| `API_CORS_ORIGINS` | `*` | Comma-separated allowed origins. `*` is dev-only. |
| `API_MAX_PAGE_SIZE` | `1000` | Hard cap on `limit`. |
| `API_RATE_LIMIT_PER_MIN` | `300` | Requests per minute per IP. |
| `API_ENABLE_ADMIN` | `true` | Set `false` to drop the `/admin/*` job triggers entirely. |

## How it works

1. **AROME is a geospatial (WCS) API, not a "city → JSON" API.** The connector
   reads `GetCapabilities` to discover coverage ids (one physical parameter per
   model run), picks the **latest run** not in the future, `DescribeCoverage` to
   learn the axes / time steps, then `GetCoverage` to fetch a tiny GeoTIFF around
   each town centroid and reads the nearest pixel value.
2. Native hourly **samples** (in canonical units — °C, %, mm, m/s, J/kg) are
   bucketed by `domain/aggregate.ts` into the 4 configurable intra-day
   **time ranges** per UTC day. Precipitation (accumulated since run start) is
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
  tasks/       dailyRun orchestrator, observation writer, observation backfill
  cli/         seed, daily, geocode, runOnce, backfillObs, reliability
  api/         Fastify read API
    server.ts  buildServer(): plugins + routes (no listen)
    start.ts   entrypoint: listen + graceful shutdown
    plugins/   prisma, errors, openapi, auth (extension point)
    schemas/   zod schemas — validation, TS types and OpenAPI in one place
    routes/    parse + delegate; no Prisma calls here
    services/  queries and row→DTO mapping; testable without HTTP
test/          fixtures + unit tests
test/api/      schema, mapping, job-registry and route (inject) tests
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

The API tests use `server.inject()` (no port binding). Schema, mapping and
job-registry tests need nothing; the route tests in `test/api/routes.db.test.ts`
run against whatever `DATABASE_URL` points at and **skip themselves** when no
database is reachable. `test/api/server.test.ts` also snapshots the `/openapi.json`
route surface, so an unintended contract change shows up as a diff.

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
