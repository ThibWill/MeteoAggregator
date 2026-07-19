-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('FORECAST', 'OBSERVATION');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "MeasurementKind" AS ENUM ('FORECAST', 'OBSERVATION');

-- CreateEnum
CREATE TYPE "WeatherCategory" AS ENUM ('CLEAR', 'PARTLY_CLOUDY', 'CLOUDY', 'FOGGY', 'RAINY', 'HEAVY_RAIN', 'SNOWY', 'STORMY');

-- CreateEnum
CREATE TYPE "PrecipLevel" AS ENUM ('NONE', 'LIGHT', 'MODERATE', 'HEAVY');

-- CreateTable
CREATE TABLE "source" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "max_horizon_days" INTEGER NOT NULL,
    "resolution" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "town" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'FR',
    "admin_area" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "bbox_min_lon" DOUBLE PRECISION,
    "bbox_min_lat" DOUBLE PRECISION,
    "bbox_max_lon" DOUBLE PRECISION,
    "bbox_max_lat" DOUBLE PRECISION,
    "geom" geometry(Point, 4326),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "geocoded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "town_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "town_source" (
    "id" SERIAL NOT NULL,
    "town_id" INTEGER NOT NULL,
    "source_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "town_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_range" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_range_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" SERIAL NOT NULL,
    "run_date" DATE NOT NULL,
    "town_id" INTEGER NOT NULL,
    "source_id" INTEGER NOT NULL,
    "model_run_time" TIMESTAMPTZ(3),
    "horizon_days" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_measurement" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER,
    "town_id" INTEGER NOT NULL,
    "source_id" INTEGER NOT NULL,
    "kind" "MeasurementKind" NOT NULL,
    "target_date" DATE NOT NULL,
    "time_range_id" INTEGER NOT NULL,
    "reference_time" TIMESTAMPTZ(3),
    "run_date" DATE,
    "lead_days" INTEGER,
    "precipitation_mm" DOUBLE PRECISION,
    "cloud_cover_pct" DOUBLE PRECISION,
    "temperature_c" DOUBLE PRECISION,
    "wind_speed_ms" DOUBLE PRECISION,
    "wind_gust_ms" DOUBLE PRECISION,
    "cape_jkg" DOUBLE PRECISION,
    "category" "WeatherCategory" NOT NULL,
    "precip_level" "PrecipLevel" NOT NULL,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weather_measurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_code_key" ON "source"("code");

-- CreateIndex
CREATE UNIQUE INDEX "town_name_country_admin_area_key" ON "town"("name", "country", "admin_area");

-- CreateIndex
CREATE INDEX "town_source_source_id_active_idx" ON "town_source"("source_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "town_source_town_id_source_id_key" ON "town_source"("town_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_run_date_town_id_source_id_key" ON "report"("run_date", "town_id", "source_id");

-- CreateIndex
CREATE INDEX "weather_measurement_town_id_target_date_time_range_id_idx" ON "weather_measurement"("town_id", "target_date", "time_range_id");

-- CreateIndex
CREATE INDEX "weather_measurement_source_id_kind_target_date_idx" ON "weather_measurement"("source_id", "kind", "target_date");

-- CreateIndex
CREATE INDEX "weather_measurement_target_date_lead_days_idx" ON "weather_measurement"("target_date", "lead_days");

-- CreateIndex
CREATE UNIQUE INDEX "weather_measurement_source_id_kind_town_id_target_date_time_key" ON "weather_measurement"("source_id", "kind", "town_id", "target_date", "time_range_id", "reference_time");

-- AddForeignKey
ALTER TABLE "town_source" ADD CONSTRAINT "town_source_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "town"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "town_source" ADD CONSTRAINT "town_source_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "town"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_measurement" ADD CONSTRAINT "weather_measurement_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_measurement" ADD CONSTRAINT "weather_measurement_town_id_fkey" FOREIGN KEY ("town_id") REFERENCES "town"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_measurement" ADD CONSTRAINT "weather_measurement_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_measurement" ADD CONSTRAINT "weather_measurement_time_range_id_fkey" FOREIGN KEY ("time_range_id") REFERENCES "time_range"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateView: convenience view for the forecast-vs-observed comparison use case.
-- Each forecast row is paired with the matching observation (same town / target
-- date / time-range / source). NULL observation columns mean "not yet observed".
CREATE VIEW "forecast_vs_observed" AS
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
  o."precip_level"     AS observed_precip_level
FROM "weather_measurement" f
LEFT JOIN "weather_measurement" o
  ON o."kind" = 'OBSERVATION'
 AND o."town_id" = f."town_id"
 AND o."target_date" = f."target_date"
 AND o."time_range_id" = f."time_range_id"
WHERE f."kind" = 'FORECAST';
