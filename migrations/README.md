# Migrations

Applied automatically at startup (and via `npm run migrate`), tracked in the
`schema_migrations` table by filename. Each file runs at most once, ever, in
filename order.

- `NNNN_description.sql` — plain SQL, executed statement by statement. Only
  use this for statements that are safe to run once and never again (new
  `CREATE TABLE IF NOT EXISTS`, one-off backfills). Do not put a plain
  `ALTER TABLE ... ADD COLUMN` here without checking `information_schema`
  first — it fails loudly on a second run, and because it is tracked, there
  won't be a second run in normal operation, but a partially-applied file
  (crash mid-migration) would otherwise be unrecoverable without manual SQL.
- `NNNN_description.mjs` — a module with a default export
  `async function run({ q, db, ensureColumn })`. Use this for column-level
  changes; call `ensureColumn(table, column, definition)` (checks
  `information_schema` before altering) so the migration is safe to re-run
  by hand if it ever needs to be.

Rules:

- Never edit or delete a migration that has already shipped in a release —
  write a new one instead. Existing installs have already recorded it as
  applied.
- Zero-pad the numeric prefix and keep it strictly increasing.
