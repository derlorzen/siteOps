CREATE TABLE IF NOT EXISTS cms_releases (
  version VARCHAR(80) PRIMARY KEY,
  digest CHAR(64) NOT NULL,
  package LONGTEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cms_installations (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL UNIQUE,
  base_url VARCHAR(500) NOT NULL,
  agent_credentials LONGTEXT NOT NULL,
  version VARCHAR(80) NULL,
  state VARCHAR(40) NOT NULL DEFAULT 'pending',
  last_checked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_cms_installation_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cms_jobs (
  id CHAR(36) PRIMARY KEY,
  installation_id CHAR(36) NOT NULL,
  release_version VARCHAR(80) NULL,
  previous_version VARCHAR(80) NULL,
  kind VARCHAR(30) NOT NULL,
  state VARCHAR(40) NOT NULL DEFAULT 'queued',
  run_at DATETIME(3) NOT NULL,
  encrypted_payload LONGTEXT NULL,
  phase VARCHAR(80) NOT NULL DEFAULT 'queued',
  result LONGTEXT NULL,
  error TEXT NULL,
  heartbeat_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  CONSTRAINT fk_cms_job_installation FOREIGN KEY (installation_id) REFERENCES cms_installations(id) ON DELETE CASCADE,
  INDEX idx_cms_job_due (state,run_at),
  INDEX idx_cms_job_installation (installation_id,state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
