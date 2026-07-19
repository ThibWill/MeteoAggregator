# MeteoAggregator — Implementation Plan

> This document is the implementation brief. It is meant to be handed to a fresh
> session as the prompt. It contains the goal, the confirmed design decisions,
> the database schema, the connector architecture, the AROME integration
> details, and a phased task list.

---

## 1. Goal

Aggregate weather data from multiple sources into a database so that, over time,
we can **compare what was forecast (from D-7 … D-0) against what actually
happened**. The comparison must be sliceable by **city** and by **weather
source**.

A daily task (cron for now) will:

1. Read the list of **towns** to track from the DB (France-focused, but no hard
   restriction).
2. For each town, fetch a **forecast** for the coming days and write a **daily
   report** broken down by day and by intra-day **time range**, storing both the
   raw numeric parameters and a **derived weather category** (clear, cloudy,
   rainy, stormy, …) plus a precipitation level.
3. Also fetch **today's data** (nominally the "actual"/observed values) and store
   it so predictions can later be scored against reality.

The first (and initially only) source is **Météo-France AROME** via its public
WMS/WCS API. The design must make adding new sources cheap (connector pattern),
and the DB must model sources as first-class rows.

---

## 2. Confirmed decisions (from requirements Q&A)

| Topic | Decision |
|---|---|
| Forecast horizon | **AROME only for now (~48 h / ~2 days).** AROME cannot do 7 days. Schema keeps a per-source `max_horizon_days`; gaps beyond AROME's horizon are simply not filled until another source is added. |
| Weather "type" | **Store raw numeric params AND a derived category** (rule engine with tunable thresholds). |
| Database | **PostgreSQL** (with **PostGIS** for geo), accessed via **Prisma**. |
| City coordinates | **Geocode on insert and store** centroid (lat/lon) in the towns table. |
| Raster sampling | **Centroid point** — sample the single grid cell at the town centroid. |
| AROME product | **AROME 0025 (2.5 km), France** — `MF-NWP-HIGHRES-AROME-0025-FRANCE`. |
| Parameters | **Precipitation (mm), Cloud cover (%), Temperature 2 m, Wind speed + gust, CAPE.** |
| Observed "today" data | **Stubbed connector + schema slots** — interface + columns exist, implementation is a documented stub. |
| API credentials | **Available** — read a Météo-France API key from env / `.env`. |
| Time ranges | **UTC** wall-clock. Stored as minute offsets from UTC midnight; configurable so they can evolve. |
| Retention | **Keep everything** (history is the point). No auto-pruning. |

### Time ranges (UTC), partitioning the day into 4 non-overlapping windows
| Window | UTC range | start_min | end_min |
|---|---|---|---|
| night | 00:00–07:00 | 0 | 420 |
| morning | 07:00–13:00 | 420 | 780 |
| afternoon | 13:00–19:00 | 780 | 1140 |
| evening | 19:00–24:00 | 1140 | 1440 |

> Note: the original spec's "sunset (7pm–12pm)" / "night (12pm–7am)" is read as
> evening 19:00–00:00 and night 00:00–07:00 (the "12pm" is midnight). A range is
> assigned to the calendar date of its **start**, so no range crosses a day
> boundary. Names above are for humans only — the DB stores just the minute
> offsets, so ranges can be re-cut later without renaming anything.

---

## 3. Understanding the AROME API (important)

The AROME "swagger" (`Modèle_AROME_swagger.json`) is **not** a "city → JSON
weather" API. It is a Météo-France **OGC geospatial service** (WMS + WCS).
Server base: `https://public-api.meteofrance.fr/public/arome/1.0`.

- **WMS** = rendered map **images** (PNG). Avoid — would require pixel/colour
  reverse-engineering.
- **WCS `GetCoverage`** = the **raster data itself** (GeoTIFF or GRIB). ✅ This is
  our route: request a tiny bbox around a city + a time subset, then read the
  numeric value out of the returned GeoTIFF. This yields real physical values.

### Relevant WCS operations (per product, e.g. `...-AROME-0025-FRANCE-WCS`)
- `GetCapabilities` → lists every **coverage id**. Each coverage id encodes one
  physical parameter **at one model run** (reference time), plus the axes it
  supports (lat, long, time, and sometimes a height/pressure level).
- `DescribeCoverage?coverageID=...` → the axes, ranges, CRS, and time steps for a
  coverage.
- `GetCoverage` → the data. Required query params:
  - `service=WCS`, `version=2.0.1`
  - `coverageid=<from GetCapabilities>`
  - `subset=lat(<a>,<b>)`, `subset=long(<a>,<b>)`, `subset=time("<ISO8601Z>")`
    (and `subset=height(...)` when the parameter has a vertical axis, e.g. 2 m
    temperature / 10 m wind)
  - `format=image/tiff` (GeoTIFF; alt `application/wmo-grib`)
  - The combined subsets must reduce the coverage to **≤ 2 dimensions**.

### Auth
Swagger declares OAuth2 implicit, but the Météo-France public API in practice
uses an **API key**. Implement auth as a single injection point (header
`apikey: <KEY>` and/or `Authorization: Bearer <token>`), configurable, so we can
switch mechanism without touching call sites. Key comes from
`METEOFRANCE_API_KEY`.

### Key AROME facts the connector must handle
- **Horizon**: ~48 h (steps roughly hourly). `max_horizon_days = 2`.
- **Runs**: several per day (00/03/06/… UTC). `GetCapabilities` exposes the
  available runs; pick the **latest run** whose steps cover our target windows.
- **Accumulated fields**: total precipitation is **accumulated since run start**.
  Precip over a window = `value(step_end) − value(step_start)`. Instantaneous
  fields (temp, cloud, wind, CAPE) are sampled per step.
- **CRS**: France domain in EPSG:4326 (lat/long). Confirm from
  `DescribeCoverage`.
- **Coverage id naming** (illustrative — resolve real ids at runtime from
  `GetCapabilities`, do not hardcode):
  - `TOTAL_PRECIPITATION__GROUND_OR_WATER_SURFACE___<RUN>`
  - `TOTAL_CLOUD_COVER__GROUND_OR_WATER_SURFACE___<RUN>`
  - `TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___<RUN>` (height = 2 m)
  - `WIND_SPEED_GUST__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___<RUN>` (10 m)
  - `WIND_SPEED__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___<RUN>` (10 m)
  - `CONVECTIVE_AVAILABLE_POTENTIAL_ENERGY__...___<RUN>`
  - The connector must **discover** exact ids + available time steps by parsing
    `GetCapabilities` for the chosen product, and map our logical parameter names
    → concrete coverage ids for the chosen run.

---

## 4. Tech stack

- **Runtime**: Node.js (LTS ≥ 20), **TypeScript**, ESM.
- **DB**: PostgreSQL 16 + **PostGIS**. **Prisma** for schema + migrations +
  client. (Geo columns that Prisma doesn't model natively are handled via
  `Unsupported("geometry")` / raw SQL in migrations; centroid is stored as plain
  `lat`/`lon` doubles which is all the point-sampling needs, with an optional
  PostGIS `geom` for future spatial queries.)
- **HTTP**: native `fetch` (undici).
- **GeoTIFF parsing**: [`geotiff`](https://www.npmjs.com/package/geotiff) to read
  the pixel value from the WCS response.
- **XML parsing** (GetCapabilities/DescribeCoverage): `fast-xml-parser`.
- **Config/validation**: `zod` + `dotenv`.
- **Dates**: `luxon` (UTC handling, ISO step math).
- **Geocoding**: `https://api-adresse.data.gouv.fr/search/` (free, no key, ideal
  for French towns) → centroid lon/lat; fallback Nominatim for non-FR towns.
- **Scheduling**: a `daily` npm script invoked by **system cron** (documented).
  Optionally `node-cron` for a long-running variant later.
- **Testing**: `vitest`. Unit-test aggregation + categorization + capabilities
  parsing against fixtures; integration tests behind a live-API flag.

---

## 5. Database schema (Prisma-oriented)

Design principles: sources are first-class; measurements are one normalized
table with a `kind` discriminator so forecast-vs-observed comparison is a simple
query grouped by town × source × target_date × time_range × lead.

### `source`
The weather source / connector.
- `id` PK
- `code` unique (e.g. `arome-0025-france`)
- `name`
- `kind` enum `SourceKind { FORECAST, OBSERVATION }`
- `max_horizon_days` int (AROME = 2)
- `resolution` text nullable (e.g. `2.5km`)
- `active` bool
- `config` jsonb (product id, base url overrides, param→coverage mapping hints)
- `created_at`, `updated_at`

Seed one row: AROME forecast source. (Optionally a second placeholder
`OBSERVATION` source for the stub.)

### `town`
- `id` PK
- `name`
- `country` (default `FR`)
- `admin_area` nullable (region/department)
- `latitude` double, `longitude` double (centroid, from geocoding)
- `bbox_min_lon/min_lat/max_lon/max_lat` double nullable (optional, for future
  bbox averaging)
- `geom` `Unsupported("geometry(Point,4326)")` nullable (PostGIS, optional)
- `timezone` text (informational; default `UTC` per decision)
- `active` bool
- `geocoded_at` nullable
- `created_at`, `updated_at`
- unique `(name, country, admin_area)`

Seed: Lyon, Mulhouse, Paris, Plouha (all FR).

### `town_source`
Which towns are tracked for which sources (many-to-many, lets a town opt into
specific sources).
- `id` PK
- `town_id` FK, `source_id` FK
- `active` bool
- unique `(town_id, source_id)`

> The daily task iterates active `town_source` pairs for `FORECAST` sources.

### `time_range`
Configurable intra-day windows (no fixed names — just offsets).
- `id` PK
- `code` text nullable (human hint, e.g. `morning`)
- `start_minute` int (0–1439, minutes from UTC midnight)
- `end_minute` int (1–1440)
- `sort_order` int
- `active` bool
- `created_at`, `updated_at`

Seed the 4 rows from §2.

### `report`
Audit/orchestration record: one per (town, source, run) of the daily task.
- `id` PK
- `run_date` date (UTC date the task ran)
- `town_id` FK, `source_id` FK
- `model_run_time` timestamptz nullable (AROME reference time used)
- `horizon_days` int
- `status` enum `ReportStatus { PENDING, SUCCESS, PARTIAL, FAILED }`
- `error` text nullable
- `started_at`, `finished_at`
- unique `(run_date, town_id, source_id)`  ← idempotent re-runs

### `weather_measurement`
The core data table. One row = one town × source × target_date × time_range ×
reference_time, of a given `kind`.
- `id` PK
- `report_id` FK nullable (set for forecasts; null for standalone observations)
- `town_id` FK, `source_id` FK
- `kind` enum `MeasurementKind { FORECAST, OBSERVATION }`
- `target_date` date (UTC)
- `time_range_id` FK
- `reference_time` timestamptz nullable (model run time for forecasts; the
  observation window start for observations)
- `run_date` date nullable (date the forecast was produced → `lead_days =
  target_date − run_date`; stored explicitly for fast slicing)
- `lead_days` int nullable (0 for observation/analysis; 0..N for forecasts)
- Numeric params (all nullable doubles):
  - `precipitation_mm`
  - `cloud_cover_pct`
  - `temperature_c`
  - `wind_speed_ms`
  - `wind_gust_ms`
  - `cape_jkg`
- Derived:
  - `category` enum `WeatherCategory { CLEAR, PARTLY_CLOUDY, CLOUDY, FOGGY,
    RAINY, HEAVY_RAIN, SNOWY, STORMY }`
  - `precip_level` enum `PrecipLevel { NONE, LIGHT, MODERATE, HEAVY }`
- `raw` jsonb (every sampled value + provenance: coverage ids, pixel coords,
  units, steps used, aggregation method)
- `created_at`, `updated_at`
- **unique** `(source_id, kind, town_id, target_date, time_range_id,
  reference_time)` → upsert-friendly; keeps multiple forecasts (different runs /
  lead times) for the same target.
- Indexes: `(town_id, target_date, time_range_id)`,
  `(source_id, kind, target_date)`, `(target_date, lead_days)`.

### Comparison query (the whole point)
For a `(town, target_date, time_range)`:
- all `FORECAST` rows across `reference_time` / `lead_days` (D-2, D-1, D-0),
- joined to the `OBSERVATION` row,
- grouped/sliced by `source` and `town`.
This falls straight out of the schema; add a SQL view `forecast_vs_observed`
later for convenience.

---

## 6. Connector architecture

Everything source-specific lives behind interfaces so new sources are additive.

```ts
// connectors/types.ts
export interface GeoPoint { lat: number; lon: number }

export interface ForecastSample {
  validTime: Date;        // UTC valid time of this step
  referenceTime: Date;    // model run
  params: Partial<Record<ParamKey, number>>; // raw numeric values in canonical units
}

export type ParamKey =
  | 'precipitation_mm' | 'cloud_cover_pct' | 'temperature_c'
  | 'wind_speed_ms' | 'wind_gust_ms' | 'cape_jkg';

export interface ForecastConnector {
  code: string;
  maxHorizonDays: number;
  /** Return native-step samples for a point over the horizon. */
  fetchForecast(point: GeoPoint, opts: { now: Date; params: ParamKey[] }): Promise<ForecastSample[]>;
}

export interface ObservationConnector {
  code: string;
  /** Observed values for a point for a given day. */
  fetchObservations(point: GeoPoint, day: Date, opts: { params: ParamKey[] }): Promise<ForecastSample[]>;
}
```

- **Canonical units** (connector's job to convert into these): precipitation mm,
  cloud %, temperature °C (AROME gives Kelvin → subtract 273.15), wind m/s, CAPE
  J/kg.
- A `registry` maps `source.code` → connector instance.
- The **orchestrator** is source-agnostic: it takes samples, buckets them into
  `(target_date, time_range)`, aggregates, categorizes, and upserts
  `weather_measurement` rows. It never knows about WCS/GeoTIFF.

### AROME connector (`connectors/arome/`)
Responsibilities:
1. `getCapabilities(product)` → parse XML → list coverages with parameter,
   reference time, and available time steps. Cache per run.
2. `resolveCoverages(run, params)` → logical `ParamKey` → concrete `coverageid`
   (+ whether a `height` subset is required and its value).
3. `getCoverageValueAtPoint(coverageid, point, time)`:
   - build `GetCoverage` URL with a small `subset=lat(..)`/`subset=long(..)`
     window around the centroid, `subset=time("...")`, `format=image/tiff`,
     `+ subset=height(...)` when needed,
   - fetch GeoTIFF, read the nearest pixel to the centroid via `geotiff`,
   - return the numeric value (handle nodata/fill values).
4. `fetchForecast()`:
   - choose latest run covering the horizon,
   - for each param and each time step, sample the point,
   - convert units, assemble `ForecastSample[]`,
   - for **precipitation** (accumulated) keep the accumulated series so the
     orchestrator can difference across a window (or expose per-step deltas — pick
     one, document it).
   - Concurrency-limited (e.g. `p-limit`) and retried with backoff; be polite to
     the API (rate limits).

### Observation connector (`connectors/observation/stub.ts`)
- Implements `ObservationConnector` but returns `[]` (or throws
  `NotImplemented`) with a clear TODO documenting the intended real source
  (Météo-France observation/analysis API or physical sensors). The daily task
  tolerates an empty observation result. Optionally implement the "AROME
  analysis / hour-0" approximation later.

---

## 7. Domain logic

### `domain/aggregate.ts` — hourly steps → time-range values
For a `(target_date, time_range)`:
- select samples whose `validTime` falls in `[start_minute, end_minute)` UTC of
  that date,
- **precipitation_mm** = accumulation over the window (difference of accumulated
  field between window end and start, or sum of per-step deltas),
- **cloud_cover_pct**, **temperature_c** = mean over steps (temp could also keep
  min/max in `raw`),
- **wind_speed_ms** = mean, **wind_gust_ms** = max, **cape_jkg** = max,
- record which steps/coverages were used in `raw`.
- If a window has no steps (beyond AROME horizon), **skip** — no row written.

### `domain/categorize.ts` — derived category + precip level (tunable rules)
Rule engine over the aggregated values; thresholds centralized in config so they
can be tuned. Illustrative defaults:
- `precip_level`: `NONE` <0.1 mm, `LIGHT` <2.5, `MODERATE` <7.6, `HEAVY` ≥7.6
  (per window).
- `category` (priority order):
  - `STORMY` if `cape_jkg` high (e.g. >800) **and** precip ≥ MODERATE (and/or
    gusts high),
  - `HEAVY_RAIN` if precip `HEAVY`,
  - `RAINY` if precip ≥ `LIGHT`,
  - `SNOWY` if precipitating **and** `temperature_c` ≤ ~0.5 (later refine with a
    snow/precip-type field),
  - else by cloud cover: `CLEAR` <20 %, `PARTLY_CLOUDY` <60 %, `CLOUDY` else,
  - `FOGGY` left as a future refinement (needs visibility/humidity).
- Keep the raw numbers regardless so categories can be recomputed historically.

### `domain/timeRanges.ts`
Load active `time_range` rows; helpers to test whether a UTC `validTime` belongs
to a `(date, range)`.

---

## 8. Daily task orchestration (`tasks/dailyRun.ts`)

Pseudocode:
```
now = utcNow()
runDate = utcDate(now)
timeRanges = loadActiveTimeRanges()
for source in activeForecastSources():
  connector = registry.get(source.code)
  caps = connector.getCapabilities()          // cached per run
  for pair in activeTownSources(source):
    town = pair.town
    ensureGeocoded(town)                        // geocode+persist if missing
    report = upsertReport(runDate, town, source, status=PENDING)
    try:
      samples = connector.fetchForecast({lat,lon}, {now, params})
      for targetDate in horizonDates(now, source.max_horizon_days):
        for range in timeRanges:
          agg = aggregate(samples, targetDate, range)
          if agg is empty: continue
          m = categorize(agg)
          upsertMeasurement(FORECAST, town, source, targetDate, range,
                            referenceTime=run, runDate, leadDays, m, raw)
      // today's observation (stub-tolerant)
      obs = observationConnector.fetchObservations({lat,lon}, runDate, {params})
      for range in timeRanges:
        aggObs = aggregate(obs, runDate, range)
        if aggObs not empty:
          upsertMeasurement(OBSERVATION, town, obsSource, runDate, range,
                            referenceTime=obsWindow, m, raw)
      report.status = SUCCESS (or PARTIAL if some params/windows missing)
    catch e:
      report.status = FAILED; report.error = e
    finally:
      report.finished_at = now; save(report)
```
- **Idempotent**: unique constraints + upserts make re-runs safe.
- **Resilient**: per-town try/catch; one town's failure doesn't abort the run.
- **Observable**: structured logs + report rows summarize each run.

### CLI entry points (`cli/`)
- `seed` — insert time ranges, AROME source, the 4 towns (+ geocode them),
  town_source links.
- `daily` — run the orchestrator once (this is what cron calls).
- `geocode` — (re)geocode towns missing coordinates.
- `run-once --town=Lyon` — debugging a single town.

### Cron
Document a crontab entry, e.g. run at 05:10 UTC daily:
```
10 5 * * * cd /path/to/MeteoAggregator && /usr/bin/node dist/cli/daily.js >> logs/daily.log 2>&1
```
(Choose a run time after AROME's early run is published.)

---

## 9. Project structure

```
MeteoAggregator/
  PLAN.md
  Modèle_AROME_swagger.json
  package.json  tsconfig.json  .env.example
  prisma/
    schema.prisma
    migrations/
  src/
    config/            env + threshold config (zod)
    db/                prisma client singleton
    connectors/
      types.ts
      registry.ts
      arome/           capabilities.ts, coverage.ts, geotiff.ts, connector.ts, params.ts
      observation/     stub.ts
    geocoding/         adresse.ts (+ nominatim fallback)
    domain/            timeRanges.ts, aggregate.ts, categorize.ts, units.ts
    tasks/             dailyRun.ts
    cli/               seed.ts, daily.ts, geocode.ts, runOnce.ts
    lib/               http.ts (auth injection, retry), logger.ts, concurrency.ts
  test/
    fixtures/          sample GetCapabilities XML, sample GeoTIFF
    *.test.ts
```

### Env (`.env.example`)
```
DATABASE_URL=postgresql://user:pass@localhost:5432/meteo
METEOFRANCE_API_KEY=...
METEOFRANCE_BASE_URL=https://public-api.meteofrance.fr/public/arome/1.0
AROME_PRODUCT=MF-NWP-HIGHRES-AROME-0025-FRANCE
GEOCODER_URL=https://api-adresse.data.gouv.fr/search/
HTTP_CONCURRENCY=4
LOG_LEVEL=info
```

---

## 10. Phased implementation

**Phase 0 — Scaffold**: TS/ESM project, tsconfig, eslint/prettier, vitest,
dotenv+zod config, logger, HTTP helper with auth injection + retry.

**Phase 1 — DB**: Postgres + PostGIS via docker-compose; Prisma schema (§5);
initial migration; enable PostGIS in a migration. Prisma client singleton.

**Phase 2 — Seed & geocoding**: geocoder client; `seed` CLI inserting time
ranges, AROME source, 4 towns (geocoded), town_source links.

**Phase 3 — AROME connector**: GetCapabilities parser (+ fixture test); coverage
URL builder; GeoTIFF point reader; unit conversions; `fetchForecast`
returning `ForecastSample[]`. Integration test behind a live-API flag.

**Phase 4 — Domain**: aggregate (window bucketing + precip accumulation),
categorize (thresholds in config) — both fully unit-tested with fixtures.

**Phase 5 — Orchestrator**: `dailyRun` writing `report` + `weather_measurement`
(forecast); observation stub wired in and tolerated. `daily` CLI. Idempotency
verified by running twice.

**Phase 6 — Cron & docs**: crontab example, README (setup, env, run), and a
`forecast_vs_observed` SQL view for the comparison use case.

---

## 11. Open items / future

- **7-day horizon**: add a second `FORECAST` connector (e.g. Open-Meteo / ECMWF
  IFS) to fill D-3…D-7; it plugs in via `ForecastConnector` and its own `source`
  row with `max_horizon_days = 7`. No schema change needed.
- **Real observations**: replace the stub with a Météo-France observation/analysis
  source or physical sensors; same `weather_measurement` table, `kind =
  OBSERVATION`.
- **Snow / fog / precip-type**: add precipitation-type & visibility params to
  sharpen categories.
- **Bbox averaging**: bbox columns already present; add an aggregation mode.
- **Local-time ranges**: if UTC windows prove awkward, switch `time_range` to a
  per-town local interpretation (Europe/Paris + DST) — data model already
  supports it since ranges are stored as offsets, not names.
- **Scoring/metrics & dashboard**: build error metrics (category hit-rate, precip
  MAE) sliced by city × source × lead time on top of `forecast_vs_observed`.
```
