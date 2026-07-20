# Plan — Read API over the aggregated weather database

> Implementation brief for an agent. Read `CLAUDE.md` first:
> **no Prisma migrations** (`npm run db:reset` / `db:push`), minimal comments.
> Prerequisite reading: `doc/plans/PLAN.md` (schema + domain) and
> `doc/plans/PLAN_OBSERVATIONS_FIABILITE.md` (observations + reliability).

## 1. Goal

Expose the data already in the database over HTTP so that a future front end can
display it: **towns**, **sources**, **time ranges**, **measurements** (forecast
and observation) over a time period, **reports** (run history), and
**reliability** statistics.

This layer is **read-oriented**. It adds no new domain logic: everything it
returns already exists in `weather_measurement`, `report`, the
`forecast_vs_observed` view, and `src/domain/reliability.ts`. The API's job is
filtering, shaping, and pagination.

## 2. Confirmed decisions

| Topic | Decision |
|---|---|
| Language / runtime | **TypeScript, Node ≥ 20, ESM** — same as the batch app. |
| Framework | **Fastify 5** + `fastify-type-provider-zod`, with `@fastify/swagger` + `@fastify/swagger-ui` for auto-generated OpenAPI. |
| Validation | **zod** — already a dependency; the same schemas validate input and document the output. |
| Placement | **Same repo**, new `src/api/`, started with `npm run api`. Reuses `src/db/client.ts`, `src/domain/`, `src/config/env.ts` unchanged. |
| Auth | **None for now** — local/private-network only. A single `preHandler` hook is left as the documented extension point. |
| Scope | **Read endpoints + trigger endpoints** for the existing batch tasks (daily run, observation backfill). No CRUD on towns/sources yet. |
| Front end | Out of scope here. The OpenAPI document is the contract; a typed client can be generated from it later. |
| Time & units | **UTC everywhere**, ISO-8601. Dates are `YYYY-MM-DD`, instants are RFC3339 with `Z`. Units unchanged from the DB (mm, %, °C, m/s, J/kg). |

### Why Fastify + zod + OpenAPI

- Keeps the front end free to be anything (React, HTMX, a mobile app, curl).
- One zod schema per route serves three purposes: runtime validation, TS types,
  and the published OpenAPI spec — no drift.
- Fastify's serializer is fast on the large arrays this API returns
  (measurement lists over a long period).

## 3. What already exists (do not rebuild)

- `prisma` singleton — `src/db/client.ts`. **Reuse it**; do not create a second
  `PrismaClient`.
- `computeReliability(filter)` → `WindowReport[]` — `src/domain/reliability.ts`.
  Already computes the 7d / 30d / 365d windows, group stats and the confusion
  matrix. The reliability endpoint is a thin wrapper over it.
- The `forecast_vs_observed` SQL view — `prisma/sql/forecast_vs_observed.sql`.
  Use it for the forecast-vs-observed comparison endpoint.
- `dailyRun(opts)` — `src/tasks/dailyRun.ts`, and the backfill task behind
  `src/cli/backfillObs.ts`. The trigger endpoints call these directly.
- `loadActiveTimeRanges()` and friends — `src/db/repo.ts`.
- `loadEnv()` — `src/config/env.ts`. Add the new API vars there, nowhere else.
- `logger` — `src/lib/logger.ts`. Bridge it to Fastify's logger rather than
  running two log formats.

## 4. Target layout

```
src/api/
  server.ts            # buildServer(): assembles plugins + routes, no listen()
  start.ts             # entrypoint: buildServer().listen(...), signal handling
  plugins/
    prisma.ts          # decorate fastify with the existing prisma singleton
    errors.ts          # setErrorHandler -> RFC7807-ish JSON problem shape
    openapi.ts         # swagger + swagger-ui registration
  schemas/
    common.ts          # pagination, date/period params, error, enums
    town.ts
    source.ts
    timeRange.ts
    measurement.ts
    report.ts
    reliability.ts
  routes/
    health.ts
    towns.ts
    sources.ts
    timeRanges.ts
    measurements.ts
    comparison.ts
    reports.ts
    reliability.ts
    admin.ts           # trigger endpoints
  services/
    measurements.ts    # prisma queries + row -> DTO mapping
    comparison.ts      # forecast_vs_observed queries
    reports.ts
    jobs.ts            # in-process job registry for triggers
test/api/
  *.test.ts
```

Rule: **routes contain no Prisma calls**. Routes parse/validate and delegate to
`services/`, which are plain functions testable without HTTP.

## 5. Cross-cutting conventions

### 5.1 Response envelope

Collections return:

```jsonc
{
  "data": [ /* items */ ],
  "meta": { "total": 1234, "limit": 100, "offset": 0 }
}
```

Single resources return the object directly. `total` is a `COUNT(*)` issued in
the same `$transaction` as the page query, so it is consistent with the page.

### 5.2 Pagination

`limit` (default 100, max 1000) + `offset`. Every collection endpoint has a
**deterministic sort** so paging is stable — see each endpoint below. If a
measurement query would exceed the cap, the client narrows the period; there is
no cursor pagination in this pass.

### 5.3 Period filtering

A shared `PeriodQuery` schema: `from` and `to`, both `YYYY-MM-DD`, **inclusive**,
applied to `target_date` (or `run_date` for reports). Rules:

- Both optional. If neither is given, default to the **last 7 days** ending
  today (UTC) so a naive client never pulls the whole archive.
- `to` must be ≥ `from`, else `400`.
- A period longer than **400 days** is rejected with `400` on measurement
  endpoints (reliability already caps at 365d internally).

### 5.4 Errors

Single error shape, produced by `plugins/errors.ts`:

```jsonc
{ "error": { "code": "BAD_REQUEST", "message": "...", "details": [ /* zod issues */ ] } }
```

Codes: `BAD_REQUEST` (400), `NOT_FOUND` (404), `CONFLICT` (409, job already
running), `INTERNAL` (500). Never leak Prisma error text or SQL to the client;
log the full error server-side with the request id.

### 5.5 Identifiers

Resources are addressed by **numeric id**. Towns and sources additionally accept
their human key as a filter (`?town=Lyon`, `?source=arome`) because that is what
a front-end URL will carry; resolution to an id happens in the service layer,
and an unknown name is a `404`, not an empty list.

### 5.6 Serialization

- `Date` columns typed `@db.Date` → `"YYYY-MM-DD"` strings (slice the ISO
  string; do **not** let the local timezone shift them).
- `Timestamptz` columns → full ISO-8601 with `Z`.
- Prisma `Decimal`/`BigInt` (raw-query `COUNT`) → `Number` before serializing.
- Enums are returned as their DB string (`CLEAR`, `HEAVY_RAIN`, …); the front end
  owns the display labels.

## 6. Endpoints

### 6.1 Meta

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | `{ status, uptimeS }`. No DB access. |
| `GET` | `/health/db` | `SELECT 1` through Prisma; `503` if it fails. |
| `GET` | `/docs` | Swagger UI. |
| `GET` | `/openapi.json` | The generated spec. |

### 6.2 Reference data

**`GET /towns`** — query: `q` (name substring, case-insensitive), `active`
(bool, default `true`), `country`, pagination. Sorted by `name, id`.
Item: `id, name, country, adminArea, latitude, longitude, timezone, active,
geocodedAt`. Never expose `geom`.

**`GET /towns/:id`** — plus `sources`: the town's `TownSource` links
(`sourceId, sourceCode, active, stationId, stationMeta`) and a `coverage` block:
`{ firstTargetDate, lastTargetDate, measurementCount }` computed with a grouped
aggregate. This is what lets a front end disable date pickers outside the range.

**`GET /sources`** — query: `kind` (`FORECAST` | `OBSERVATION`), `active`.
Item: `id, code, name, kind, maxHorizonDays, resolution, active`. **Omit
`config`** — it may hold credentials-adjacent settings.

**`GET /time-ranges`** — active ranges ordered by `sortOrder`. Item:
`id, code, startMinute, endMinute, sortOrder`. Also expose a derived
`label` (`"07:00–13:00"`) so the front end does not re-implement the formatting.

### 6.3 Measurements — the core endpoint

**`GET /measurements`**

Query parameters:

| Param | Type | Notes |
|---|---|---|
| `townId` / `town` | int / string | at least one of `townId`/`town` **required** — refuse to scan all towns |
| `sourceId` / `source` | int / string | optional, repeatable (`?sourceId=1&sourceId=2`) |
| `kind` | `FORECAST` \| `OBSERVATION` | optional |
| `from` / `to` | date | §5.3 |
| `timeRangeId` | int, repeatable | optional |
| `leadDays` | int, repeatable | forecasts only; `leadDays=1` = "what D-1 predicted" |
| `latestOnly` | bool, default `true` | see below |
| `limit` / `offset` | int | §5.2 |

**`latestOnly`** is the important one. The same (town, source, target_date,
time_range) can hold several forecast rows, one per `reference_time` (model run).
A chart almost always wants the most recent run. With `latestOnly=true` the
service keeps, per natural-key group, the row with the greatest
`reference_time` — implemented as a `DISTINCT ON (town_id, source_id, kind,
target_date, time_range_id) ... ORDER BY ..., reference_time DESC` raw query.
With `latestOnly=false` every run is returned, which is what a "forecast
evolution as D approaches" view needs.

Sort: `target_date ASC, time_range.sort_order ASC, source_id ASC,
reference_time DESC`.

Item shape:

```jsonc
{
  "id": 1,
  "kind": "FORECAST",
  "townId": 3,
  "sourceId": 1,
  "sourceCode": "arome",
  "targetDate": "2026-07-21",
  "timeRangeId": 2,
  "timeRangeCode": "morning",
  "referenceTime": "2026-07-20T00:00:00.000Z",
  "runDate": "2026-07-20",
  "leadDays": 1,
  "values": {
    "precipitationMm": 0.4, "cloudCoverPct": 62, "temperatureC": 18.3,
    "windSpeedMs": 3.1, "windGustMs": 7.8, "capeJkg": 120
  },
  "category": "PARTLY_CLOUDY",
  "precipLevel": "LIGHT"
}
```

`raw` is **excluded by default**; add `?include=raw` to get it (it is large and
source-specific).

**`GET /measurements/timeseries`** — same filters, but returns one series per
`(source, kind)` with points keyed by `(targetDate, timeRangeId)`:

```jsonc
{
  "index": [ { "targetDate": "2026-07-21", "timeRangeId": 2, "timeRangeCode": "morning" } ],
  "series": [
    { "sourceId": 1, "sourceCode": "arome", "kind": "FORECAST",
      "points": [ { "temperatureC": 18.3, "precipitationMm": 0.4, "category": "PARTLY_CLOUDY" } ] }
  ]
}
```

Points align positionally with `index`, with `null` for gaps. This is a shaping
convenience over the same service call — a chart component can bind to it
directly instead of pivoting in the browser.

### 6.4 Forecast vs observed

**`GET /comparison`** — reads `forecast_vs_observed`. Same period/town/source
filters, plus `leadDays` and `onlyMatched` (default `true`, i.e.
`observed_source_id IS NOT NULL`). Returns rows pairing each forecast field with
its observed counterpart and a computed `delta` block (`forecast − observed`) for
the numeric fields, plus `categoryMatch` / `precipLevelMatch` booleans.

This is the endpoint a "how wrong were we on day X" view uses, as opposed to
`/reliability`, which is the aggregate.

### 6.5 Reliability

**`GET /reliability`** — query: `townId`/`town`, `sourceId`/`source` (the
forecast source), `observedSource` (code, default `mf-climatologie`), `window`
(`7d` | `30d` | `365d`; omitted = all three).

Delegates straight to `computeReliability({ townId, forecastSourceId,
observedSourceId })` and returns `WindowReport[]` as-is, with two additions the
CLI already does by hand in `src/cli/reliability.ts`: **town names** and
**time-range codes** resolved onto each group, so the front end need not join.

Extract that name-resolution from the CLI into a shared helper rather than
duplicating it.

> **Cost note.** `computeReliability` always fetches the widest window (365 d) of
> pairs and filters in memory. That is fine for the CLI but will be the API's
> slowest route. Wrap it in a short in-process cache (see §8) keyed by the
> filter, and revisit with a SQL-side aggregation only if it actually hurts.

### 6.6 Reports (run history)

**`GET /reports`** — query: `townId`/`town`, `sourceId`/`source`, `status`,
`from`/`to` on `run_date`, pagination. Sorted `run_date DESC, town_id, source_id`.
Item: `id, runDate, townId, sourceId, modelRunTime, horizonDays, status, error,
startedAt, finishedAt`, plus `measurementCount` from a `_count` include.

**`GET /reports/:id`** — the report plus its measurements (same item shape as
§6.3, capped by the standard pagination).

**`GET /reports/summary`** — per `run_date`, counts by status. Feeds a
"pipeline health" strip in the UI.

### 6.7 Triggers (admin)

These start existing batch tasks. They are **not** part of the read contract and
are grouped under `/admin` so a reverse proxy can block them in one rule.

| Method | Path | Body | Behaviour |
|---|---|---|---|
| `POST` | `/admin/jobs/daily-run` | `{ townName?, observationSourceCode? }` | starts `dailyRun(opts)` |
| `POST` | `/admin/jobs/backfill-observations` | `{ from, to, townName? }` | starts the backfill task |
| `GET` | `/admin/jobs` | — | list recent jobs |
| `GET` | `/admin/jobs/:id` | — | one job |

Semantics: **`202 Accepted`** with `{ jobId, type, status: "RUNNING", startedAt }`.
The job runs in-process; `services/jobs.ts` holds a `Map<string, JobRecord>` with
status (`RUNNING` | `SUCCESS` | `FAILED`), timestamps, the task's summary object,
and the error message. **One job per type at a time** — a second request while
one is running gets `409 CONFLICT`.

This registry is deliberately in-memory: it is lost on restart, which is
acceptable pre-production. The DB `report` table remains the durable record of
what ran. Do not build a job queue here; if durability becomes a requirement,
that is a separate plan.

## 7. Configuration

Add to `EnvSchema` in `src/config/env.ts` (nothing reads `process.env`
directly):

```ts
API_PORT: z.coerce.number().int().positive().default(3000),
API_HOST: z.string().default('0.0.0.0'),
API_CORS_ORIGINS: z.string().default('*'),   // comma-separated; '*' only for dev
API_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(1000),
API_ENABLE_ADMIN: z.coerce.boolean().default(true),
```

Mirror them in `.env.example` with comments.

`API_HOST` defaults to `0.0.0.0` because the process is meant to run in the
compose network; **exposure is controlled by the published port**, not by the
bind address. Note in `.env.example` that publishing the port to a public
interface without auth exposes the admin triggers.

## 8. Non-functional

- **Rate limiting**: `@fastify/rate-limit`, generous default (e.g. 300/min/IP).
  Cheap insurance against a front-end render loop hammering `/measurements`.
- **CORS**: `@fastify/cors`, origins from `API_CORS_ORIGINS`.
- **Compression**: `@fastify/compress` — timeseries payloads gzip extremely well.
- **Caching**: `Cache-Control: public, max-age=60` on reference data
  (`/towns`, `/sources`, `/time-ranges`); `max-age=300` on `/reliability`, plus
  the in-process memo from §6.5. Measurements are uncached.
- **Request logging**: bridge Fastify's logger into `src/lib/logger.ts` so the
  API and the batch jobs write one format. Log method, path, status, duration,
  request id.
- **Graceful shutdown**: on `SIGTERM`/`SIGINT`, `await server.close()` then
  `disconnect()`; refuse new job triggers while closing.
- **Indexes**: the existing `@@index([townId, targetDate, timeRangeId])` and
  `@@index([sourceId, kind, targetDate])` cover the main filters. Verify with
  `EXPLAIN ANALYZE` on a realistic `/measurements` query before adding any; if
  one is needed, add it to `schema.prisma` and re-apply with `npm run db:push`
  (**not** a migration — see `CLAUDE.md`).

## 9. Testing

`vitest` is already configured. Use `server.inject()` — no real socket, no port
binding, fast.

1. **Schema unit tests** — the zod query schemas: defaults, period validation,
   `limit` cap, bad enum values.
2. **Service unit tests** — row→DTO mapping (especially date slicing and the
   `latestOnly` de-duplication) against fixture rows.
3. **Route tests with `inject()`** against a **test database** seeded with a
   small deterministic fixture (2 towns × 2 sources × ~5 days). Reuse
   `npm run db:reset:seed` semantics behind a `DATABASE_URL` pointing at a
   throwaway DB. Assert status codes, envelope shape, and ordering.
4. **Contract snapshot** — snapshot `/openapi.json` so an unintended breaking
   change to a response shape shows up in a diff.
5. **Error paths** — unknown town → `404`; `from` > `to` → `400`; missing town
   filter on `/measurements` → `400`; double job trigger → `409`.

## 10. Packaging

- New scripts in `package.json`:
  ```json
  "api": "tsx src/api/start.ts",
  "api:dev": "tsx watch src/api/start.ts"
  ```
- New dependencies: `fastify`, `fastify-type-provider-zod`, `@fastify/swagger`,
  `@fastify/swagger-ui`, `@fastify/cors`, `@fastify/compress`,
  `@fastify/rate-limit`.
- **Docker**: the existing image already contains `src/`, `node_modules` and a
  generated Prisma client, so **no Dockerfile change is needed**. Add an `api`
  service to `docker-compose.yml` reusing `image: meteo-aggregator:local` with
  `command: npm run api`, `ports: ["3000:3000"]`, the same `env_file`,
  `depends_on: db`, and the `meteo-net` network. Keep it out of the `app`
  profile so `docker compose up -d` can bring up db + api together while batch
  tasks stay on-demand.
- Update `README.md`: how to start the API, the `/docs` URL, and the env vars.

## 11. Phased task list

**Phase 1 — skeleton**
1. Install deps; add `api` / `api:dev` scripts.
2. `src/api/server.ts` + `start.ts`; plugins: prisma, errors, openapi, cors,
   compress, rate-limit; logger bridge; graceful shutdown.
3. `/health`, `/health/db`, `/docs`, `/openapi.json`.
4. Add the API env vars to `src/config/env.ts` and `.env.example`.
   *Done when:* `npm run api` serves `/docs` and `/health/db` returns `200`.

**Phase 2 — reference data**
5. `schemas/common.ts` (pagination, period, envelope, error).
6. `/towns`, `/towns/:id`, `/sources`, `/time-ranges` + services.
   *Done when:* route tests pass against the seeded fixture DB.

**Phase 3 — measurements (the core)**
7. `services/measurements.ts`: filters, `latestOnly` `DISTINCT ON`, mapping.
8. `/measurements` and `/measurements/timeseries`.
9. `EXPLAIN ANALYZE` on a realistic query; record the result in this file.

   *Result (2026-07-20, dev DB, 84 measurement rows).* The `latestOnly`
   `DISTINCT ON` query for one town over a 32-day period plans as a seq scan on
   `weather_measurement` (21 of 84 rows kept) feeding two memoized PK index
   scans on `source` / `time_range`; execution **0.25 ms**. The seq scan is the
   planner's correct choice at this table size — the existing
   `@@index([townId, targetDate, timeRangeId])` only becomes attractive once the
   table is large enough for the index to pay for itself. **No index added.**
   Re-run this once the table reaches a realistic size.

**Phase 4 — comparison & reliability**
10. `/comparison` over `forecast_vs_observed`.
11. Extract the name-resolution helper from `src/cli/reliability.ts`; add
    `/reliability` with the memo cache.

**Phase 5 — reports & triggers**
12. `/reports`, `/reports/:id`, `/reports/summary`.
13. `services/jobs.ts` + `/admin/jobs*`, gated by `API_ENABLE_ADMIN`.

**Phase 6 — packaging**
14. Compose `api` service; README section; OpenAPI snapshot test.

## 12. Deliberately out of scope

- Authentication and multi-tenancy (the `preHandler` extension point is left in
  `plugins/errors.ts`'s sibling; wire a real check there when the API leaves the
  private network).
- Write/CRUD on towns, sources and time ranges — the seed CLI still owns those.
- A durable job queue, websockets/SSE for live job progress, and GraphQL.
- The front end itself. It consumes `/openapi.json`.

## 13. Open questions for later

- Does the front end need **cursor pagination** for long archives, or is
  period-narrowing enough? (Assume enough until proven otherwise.)
- Should `/reliability` gain a **per-parameter time series** (MAE per day) for a
  trend chart? Currently only rolling-window aggregates exist.
- Once several forecast sources are active, is there demand for a
  **consensus/ensemble** endpoint (mean + spread across sources per slot)? That
  would be new domain logic, so it belongs in `src/domain/`, not in the API.
