-- Task collaboration, attachments, recurring jobs and invoice delivery audit (additive migration).
CREATE TABLE IF NOT EXISTS billing_task_checklist (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  text VARCHAR(500) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  sort_position INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_billing_checklist_task FOREIGN KEY(task_id) REFERENCES project_tasks(id) ON DELETE CASCADE,
  INDEX idx_billing_checklist_task(task_id,sort_position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS billing_task_comments (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  actor VARCHAR(120) NOT NULL DEFAULT 'SiteOps',
  text TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_billing_comments_task FOREIGN KEY(task_id) REFERENCES project_tasks(id) ON DELETE CASCADE,
  INDEX idx_billing_comments_task(task_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS billing_task_files (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes INT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  content_base64 LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_billing_files_task FOREIGN KEY(task_id) REFERENCES project_tasks(id) ON DELETE CASCADE,
  INDEX idx_billing_files_task(task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS billing_recurring_rules (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  task_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  every_days INT NOT NULL,
  next_run_at DATETIME NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at DATETIME NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_billing_rules_project FOREIGN KEY(project_id) REFERENCES customer_projects(id) ON DELETE CASCADE,
  INDEX idx_billing_rules_due(enabled,next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS billing_invoice_mails (
  id CHAR(36) PRIMARY KEY,
  invoice_id CHAR(36) NOT NULL,
  kind VARCHAR(30) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'sending',
  sent_at DATETIME NULL,
  message_id VARCHAR(255) NULL,
  error_text VARCHAR(1500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_billing_mails_invoice FOREIGN KEY(invoice_id) REFERENCES invoices(id),
  INDEX idx_billing_mails_invoice(invoice_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS monitor_billing_tasks (
  incident_id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_monitor_billing_incident FOREIGN KEY(incident_id) REFERENCES incidents(id),
  CONSTRAINT fk_monitor_billing_task FOREIGN KEY(task_id) REFERENCES project_tasks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
