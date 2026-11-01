CREATE TABLE IF NOT EXISTS invoice_draft_resets (
 original_invoice_id CHAR(36) PRIMARY KEY,
 draft_invoice_id CHAR(36) NULL UNIQUE,
 reason VARCHAR(2000) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_reset_original FOREIGN KEY (original_invoice_id) REFERENCES invoices(id),
 CONSTRAINT fk_reset_draft FOREIGN KEY (draft_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
