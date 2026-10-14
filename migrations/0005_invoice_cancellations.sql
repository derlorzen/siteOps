-- An issued invoice must be reversed with a separate numbered, archived document.
CREATE TABLE IF NOT EXISTS invoice_cancellations (
  id CHAR(36) PRIMARY KEY,
  invoice_id CHAR(36) NOT NULL UNIQUE,
  cancellation_number VARCHAR(50) NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'archiving',
  snapshot_json LONGTEXT NOT NULL,
  pdf_base64 LONGTEXT NOT NULL,
  archive_sha256 CHAR(64) NULL,
  archive_commit CHAR(40) NULL,
  archive_path VARCHAR(255) NULL,
  error_message TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  archived_at DATETIME(3) NULL,
  CONSTRAINT fk_invoice_cancellation_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
