#!/usr/bin/env sh
set -e

# Optional one-time DB setup on container start. The DB is disposable in this
# project (no migrations): apply the Prisma schema non-destructively and
# (re)create the non-Prisma view, then optionally seed.
#   DB_INIT=1  -> prisma db push (--skip-generate) + apply forecast_vs_observed view
#   DB_SEED=1  -> also run `npm run seed` (implies the schema is applied)
if [ "${DB_INIT:-0}" = "1" ]; then
  echo "[entrypoint] Applying Prisma schema (db push, non-destructive)..."
  npx prisma db push --skip-generate
  echo "[entrypoint] Applying forecast_vs_observed view..."
  npx prisma db execute --file prisma/sql/forecast_vs_observed.sql --schema prisma/schema.prisma
fi

if [ "${DB_SEED:-0}" = "1" ]; then
  echo "[entrypoint] Seeding towns/sources/time ranges..."
  npm run seed
fi

exec "$@"
