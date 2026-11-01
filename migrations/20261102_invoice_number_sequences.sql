CREATE TABLE IF NOT EXISTS invoice_number_sequences (
 prefix VARCHAR(20) NOT NULL,
 invoice_year INT NOT NULL,
 last_number BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY (prefix,invoice_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO invoice_number_sequences(prefix,invoice_year,last_number)
 SELECT 'RE',invoice_year,last_number FROM billing_sequences
 ON DUPLICATE KEY UPDATE last_number=GREATEST(invoice_number_sequences.last_number,VALUES(last_number));
