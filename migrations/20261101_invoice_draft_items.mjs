export default async function run({ q, db, ensureColumn }) {
  const result = await q(
    "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoice_items' AND COLUMN_NAME='entry_id'"
  );
  if (result.rows[0]?.IS_NULLABLE === 'NO') {
    await db.query('ALTER TABLE invoice_items MODIFY COLUMN entry_id CHAR(36) NULL');
  }
  await ensureColumn('invoice_items', 'quantity', 'DECIMAL(14,6) NULL');
  await ensureColumn('invoice_items', 'unit', "VARCHAR(40) NOT NULL DEFAULT 'Std.'");
  await ensureColumn('invoice_items', 'sort_position', 'INT NOT NULL DEFAULT 0');
}
