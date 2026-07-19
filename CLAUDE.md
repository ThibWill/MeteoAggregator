# Working agreements for this repo

## Database — no migrations (pre-production)

This project is **not production-ready**; the database is **disposable**.

- **Do NOT create or run Prisma migrations** (`prisma migrate ...`) for now.
- To change the schema: edit `prisma/schema.prisma`, then **drop and re-apply**:
  ```bash
  npm run db:reset        # drop everything + re-apply schema + recreate the view
  npm run db:reset:seed   # same, then re-seed towns/sources/time ranges
  ```
  `db:reset` runs `prisma db push --force-reset` (no migration history) and then
  re-applies non-Prisma objects from `prisma/sql/` (currently the
  `forecast_vs_observed` view).
- Prefer `npm run db:push` for a non-destructive schema sync when you don't need
  to wipe data.
- Any new non-Prisma SQL object (view/function/trigger) goes in `prisma/sql/`
  as an idempotent (`CREATE OR REPLACE`) file so `db:reset` can recreate it.

## Comments — keep them minimal

Do not over-comment. Add a comment only where a next agent genuinely needs it to
understand a non-obvious decision (e.g. an API quirk, a unit gotcha). Skip
comments that just restate the code. Keep the codebase clean.
