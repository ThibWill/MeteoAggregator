-- Non-Prisma DB object: the forecast-vs-observed comparison view.
-- Re-applied by `npm run db:reset` after `prisma db push` (which only manages
-- the models). Idempotent.
CREATE OR REPLACE VIEW "forecast_vs_observed" AS
SELECT
  f."town_id",
  f."source_id",
  f."target_date",
  f."time_range_id",
  f."reference_time"  AS forecast_reference_time,
  f."run_date"        AS forecast_run_date,
  f."lead_days",
  f."precipitation_mm" AS forecast_precip_mm,
  f."cloud_cover_pct"  AS forecast_cloud_pct,
  f."temperature_c"    AS forecast_temp_c,
  f."wind_speed_ms"    AS forecast_wind_ms,
  f."wind_gust_ms"     AS forecast_gust_ms,
  f."cape_jkg"         AS forecast_cape_jkg,
  f."category"         AS forecast_category,
  f."precip_level"     AS forecast_precip_level,
  o."precipitation_mm" AS observed_precip_mm,
  o."cloud_cover_pct"  AS observed_cloud_pct,
  o."temperature_c"    AS observed_temp_c,
  o."wind_speed_ms"    AS observed_wind_ms,
  o."wind_gust_ms"     AS observed_gust_ms,
  o."cape_jkg"         AS observed_cape_jkg,
  o."category"         AS observed_category,
  o."precip_level"     AS observed_precip_level,
  -- Appended last so CREATE OR REPLACE stays valid (it can only add columns at
  -- the end): lets reliability filter on the observation source (mf-climatologie).
  o."source_id"        AS observed_source_id,
  f."lead_minutes"
FROM "weather_measurement" f
LEFT JOIN "weather_measurement" o
  ON o."kind" = 'OBSERVATION'
 AND o."town_id" = f."town_id"
 AND o."target_date" = f."target_date"
 AND o."time_range_id" = f."time_range_id"
WHERE f."kind" = 'FORECAST';
