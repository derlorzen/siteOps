-- Customer/project/time and immutable invoice issuance tracking.
CREATE TABLE IF NOT EXISTS customers (
 id CHAR(36) PRIMARY KEY,
 name VARCHAR(255) NOT NULL,
 contact_name VARCHAR(255) NULL,
 email VARCHAR(255) NULL,
 street VARCHAR(255) NULL,
 postal_code VARCHAR(24) NULL,
 city VARCHAR(150) NULL,
 country CHAR(2) NOT NULL DEFAULT 'DE',
 vat_id VARCHAR(50) NULL,
 notes TEXT NULL,
 default_hourly_cents INT NOT NULL DEFAULT 7500,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_projects (
 id CHAR(36) PRIMARY KEY,
 customer_id CHAR(36) NOT NULL,
 site_id CHAR(36) NULL,
 name VARCHAR(255) NOT NULL,
 description TEXT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'active',
 hourly_cents INT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_customer_project_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
 CONSTRAINT fk_customer_project_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL,
 INDEX idx_customer_projects_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_tasks (
 id CHAR(36) PRIMARY KEY,
 project_id CHAR(36) NOT NULL,
 name VARCHAR(255) NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'open',
 hourly_cents INT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_project_tasks_project FOREIGN KEY (project_id) REFERENCES customer_projects(id),
 INDEX idx_project_tasks_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS time_entries (
 id CHAR(36) PRIMARY KEY,
 task_id CHAR(36) NOT NULL,
 entry_date DATE NOT NULL,
 kind VARCHAR(20) NOT NULL DEFAULT 'work',
 description VARCHAR(1000) NOT NULL DEFAULT '',
 contact_name VARCHAR(255) NULL,
 duration_seconds INT NOT NULL DEFAULT 0,
 started_at DATETIME(3) NULL,
 billable BOOLEAN NOT NULL DEFAULT TRUE,
 hourly_cents INT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_time_entries_task FOREIGN KEY (task_id) REFERENCES project_tasks(id),
 INDEX idx_time_entries_task_date (task_id,entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_settings (
 setting_key VARCHAR(100) PRIMARY KEY,
 setting_value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_sequences (
 invoice_year INT PRIMARY KEY,
 last_number INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
 id CHAR(36) PRIMARY KEY,
 customer_id CHAR(36) NOT NULL,
 invoice_number VARCHAR(50) NULL UNIQUE,
 status VARCHAR(30) NOT NULL DEFAULT 'draft',
 service_from DATE NOT NULL,
 service_to DATE NOT NULL,
 issued_at DATETIME(3) NULL,
 due_at DATE NULL,
 paid_at DATETIME(3) NULL,
 cancelled_at DATETIME(3) NULL,
 cancellation_reason TEXT NULL,
 net_cents BIGINT NOT NULL DEFAULT 0,
 tax_cents BIGINT NOT NULL DEFAULT 0,
 gross_cents BIGINT NOT NULL DEFAULT 0,
 snapshot_json LONGTEXT NULL,
 pdf_base64 LONGTEXT NULL,
 archive_sha256 CHAR(64) NULL,
 archive_commit CHAR(40) NULL,
 archive_path VARCHAR(255) NULL,
 error_message TEXT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
 INDEX idx_invoices_customer (customer_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
 id CHAR(36) PRIMARY KEY,
 invoice_id CHAR(36) NOT NULL,
 entry_id CHAR(36) NOT NULL UNIQUE,
 description VARCHAR(1000) NOT NULL,
 entry_date DATE NOT NULL,
 duration_seconds INT NOT NULL,
 hourly_cents INT NOT NULL,
 amount_cents BIGINT NOT NULL,
 CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
 CONSTRAINT fk_invoice_items_entry FOREIGN KEY (entry_id) REFERENCES time_entries(id),
 INDEX idx_invoice_items_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
