#!/usr/bin/env bash
# Pre-production DB reset: DROP everything and re-apply prisma/schema.prisma
# directly (no migration history), then re-create non-Prisma objects (the view).
# The database is disposable here — this wipes all data.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Resetting database (drop + re-apply schema, no migrations)..."
npx prisma db push --force-reset --accept-data-loss --skip-generate
npx prisma db execute --file prisma/sql/forecast_vs_observed.sql --schema prisma/schema.prisma
echo "Done. Run 'npm run seed' to repopulate towns/sources/time ranges."
