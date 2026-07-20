# MeteoAggregator — Web (map front end)

A map UI that reads the MeteoAggregator API and shows, per tracked town, the
weather for a chosen **day** and **intra-day window** (morning / afternoon /
evening / night), with a **forecast vs observed** toggle. Marker auras are
coloured by weather category and tinted by the selected time of day.

Stack: **Vite + React + TypeScript + Leaflet**. No server-side coupling — it
talks to the API over HTTP using hand-written types that mirror the API's Zod
schemas.

## Run with Docker Compose (recommended)

From the repo root, `docker compose up -d` brings up the DB, the API and this
front end together. The site is served by nginx, which proxies `/api/*` to the
`api` service, so no CORS or extra config is needed:

```bash
docker compose up -d          # db + api + web
# open http://localhost:8080
```

The build is defined in `web/Dockerfile` (Vite build -> nginx) and the proxy in
`web/nginx.conf`.

## Run for local development

```bash
cd web
cp .env.example .env      # optional; only needed to override the API origin
npm install
npm run dev               # http://localhost:5173
```

In dev, requests go to `/api/*` and Vite proxies them to the API. If the API is
not on `http://localhost:3000`, start the dev server with:

```bash
API_ORIGIN=http://localhost:4000 npm run dev
```

If the API can't be reached the UI falls back to **demo data** (amber "Demo"
pill) so it still renders; point it at a live API and the pill turns green
"Live".

## Build

```bash
npm run build             # -> web/dist (static assets)
npm run preview
```

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | build/runtime (`.env`) | API origin the **browser** calls in production, e.g. `https://meteo.example.com`. Empty ⇒ same-origin `/api`. |
| `API_ORIGIN` | dev only | Target the Vite dev proxy forwards `/api` to. Default `http://localhost:3000`. |

In production either:
- serve `dist/` behind the same host as the API and expose the API under `/api`
  (leave `VITE_API_BASE_URL` empty), or
- set `VITE_API_BASE_URL` to the API origin **and** add this site's origin to
  the API's `API_CORS_ORIGINS`.

## API endpoints used

- `GET /towns?active=true` — map points (needs `latitude`/`longitude`; run the
  `geocode` task if towns are missing coordinates).
- `GET /time-ranges` — the intra-day windows shown as period buttons.
- `GET /measurements?townId=&from=&to=&timeRangeId=&latestOnly=true` — one call
  per town for the selected day+window; both `FORECAST` and `OBSERVATION` rows
  come back together.

## Files

```
src/
  main.tsx           entry
  WeatherMap.tsx     the screen (controls, map, detail card, legend)
  api.ts             typed fetch client (towns, timeRanges, measurements)
  types.ts           types mirroring the API Zod schemas
  weather.ts         category colours, time-of-day theming, formatting
  markers.ts         Leaflet divIcon HTML for a town
  useWeatherData.ts  loads reference + measurements, demo fallback
  demo.ts            offline sample data (same thresholds as the server)
  styles.css         shell + marker styles
```

## Notes

- Category colours and thresholds mirror `src/domain/*` on the server; if you
  change categorization there, update `weather.ts` / `demo.ts` to match.
- Time-of-day theming is derived from each window's `startMinute`/`endMinute`,
  so any `time_ranges` configuration works without code changes.
