CREATE TABLE IF NOT EXISTS sites (
  id CHAR(36) PRIMARY KEY,
  slug VARCHAR(191) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) NOT NULL,
  protocol ENUM('sftp','ftps','ftp') NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL,
  username VARCHAR(255) NOT NULL,
  encrypted_credentials LONGTEXT NOT NULL,
  remote_root TEXT NOT NULL,
  site_type VARCHAR(50) NOT NULL DEFAULT 'php',
  deployment_mode VARCHAR(30) NOT NULL DEFAULT 'webspace',
  source_repository VARCHAR(255) NULL,
  source_branch VARCHAR(191) NULL,
  source_root TEXT NULL,
  git_credentials LONGTEXT NULL,
  hostinger_target_directory TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  backup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  backup_interval_seconds INT NOT NULL DEFAULT 86400,
  backup_max_files INT NOT NULL DEFAULT 10000,
  monitor_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  monitor_url TEXT NULL,
  monitor_interval_seconds INT NOT NULL DEFAULT 60,
  monitor_expected_status INT NOT NULL DEFAULT 200,
  monitor_content TEXT NULL,
  monitor_expected_title TEXT NULL,
  monitor_check_dns BOOLEAN NOT NULL DEFAULT TRUE,
  monitor_check_wordpress BOOLEAN NOT NULL DEFAULT FALSE,
  monitor_timeout_ms INT NOT NULL DEFAULT 10000,
  monitor_failure_threshold INT NOT NULL DEFAULT 3,
  alert_repeat_minutes INT NOT NULL DEFAULT 60,
  response_warn_ms INT NULL,
  ssl_warn_days INT NOT NULL DEFAULT 14,
  exclude_patterns LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS change_previews (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  description TEXT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  changes LONGTEXT NOT NULL,
  validation LONGTEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_change_previews_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_change_previews_site_created (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS changes (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  preview_id CHAR(36) NULL,
  description TEXT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  files LONGTEXT NOT NULL,
  pre_commit VARCHAR(64) NULL,
  post_commit VARCHAR(64) NULL,
  status VARCHAR(50) NOT NULL,
  health_result LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_changes_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_changes_preview FOREIGN KEY (preview_id) REFERENCES change_previews(id) ON DELETE SET NULL,
  INDEX idx_changes_site_created (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backups (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  git_commit VARCHAR(64) NOT NULL,
  backup_type VARCHAR(30) NOT NULL,
  file_count INT NULL,
  changed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_backups_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_backups_site_created (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_checks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  ok BOOLEAN NOT NULL,
  http_status INT NULL,
  response_ms INT NULL,
  ssl_days INT NULL,
  error TEXT NULL,
  details LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_monitor_checks_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_monitor_checks_site_created (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS incidents (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  details LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  CONSTRAINT fk_incidents_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_incidents_site_created (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS monitor_state (
  site_id CHAR(36) PRIMARY KEY,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_check_at DATETIME NULL,
  last_ok_at DATETIME NULL,
  last_alert_at DATETIME NULL,
  alert_count INT NOT NULL DEFAULT 0,
  incident_id CHAR(36) NULL,
  CONSTRAINT fk_monitor_state_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_monitor_state_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_state (
  site_id CHAR(36) PRIMARY KEY,
  last_attempt_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_error LONGTEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_backup_state_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(191) PRIMARY KEY,
  setting_value LONGTEXT NULL,
  encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS incident_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  incident_id CHAR(36) NOT NULL,
  site_id CHAR(36) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  details LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_incident_events_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  CONSTRAINT fk_incident_events_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_incident_events_incident_created (incident_id, created_at),
  INDEX idx_incident_events_site_created (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS seo_runs (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'running',
  max_pages INT NOT NULL DEFAULT 100,
  pages_crawled INT NOT NULL DEFAULT 0,
  summary LONGTEXT NULL,
  error LONGTEXT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  CONSTRAINT fk_seo_runs_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_seo_runs_site_started (site_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seo_pages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  site_id CHAR(36) NOT NULL,
  url TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INT NULL,
  response_ms INT NULL,
  content_bytes INT NULL,
  title TEXT NULL,
  meta_description TEXT NULL,
  canonical TEXT NULL,
  robots TEXT NULL,
  h1 LONGTEXT NULL,
  h2 LONGTEXT NULL,
  word_count INT NOT NULL DEFAULT 0,
  internal_links INT NOT NULL DEFAULT 0,
  external_links INT NOT NULL DEFAULT 0,
  incoming_links INT NOT NULL DEFAULT 0,
  depth INT NULL,
  pagerank DOUBLE NULL,
  issues LONGTEXT NULL,
  wdfidf LONGTEXT NULL,
  structured_data LONGTEXT NULL,
  images_total INT NOT NULL DEFAULT 0,
  images_missing_alt INT NOT NULL DEFAULT 0,
  lighthouse_mobile LONGTEXT NULL,
  lighthouse_desktop LONGTEXT NULL,
  final_url TEXT NULL,
  redirect_count INT NOT NULL DEFAULT 0,
  lang VARCHAR(50) NULL,
  hreflang LONGTEXT NULL,
  social LONGTEXT NULL,
  security LONGTEXT NULL,
  accessibility LONGTEXT NULL,
  content_hash CHAR(64) NULL,
  content_fingerprint LONGTEXT NULL,
  indexable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_seo_pages_run FOREIGN KEY (run_id) REFERENCES seo_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_seo_pages_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_seo_pages_run (run_id),
  INDEX idx_seo_pages_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seo_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  site_id CHAR(36) NOT NULL,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  anchor_text TEXT NULL,
  internal_link BOOLEAN NOT NULL DEFAULT TRUE,
  nofollow BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_seo_links_run FOREIGN KEY (run_id) REFERENCES seo_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_seo_links_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_seo_links_run (run_id),
  INDEX idx_seo_links_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS synthetic_tests (
  id CHAR(36) PRIMARY KEY,
  site_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  start_url TEXT NOT NULL,
  steps LONGTEXT NOT NULL,
  encrypted_secrets LONGTEXT NULL,
  interval_seconds INT NOT NULL DEFAULT 3600,
  timeout_ms INT NOT NULL DEFAULT 30000,
  viewport_width INT NOT NULL DEFAULT 1440,
  viewport_height INT NOT NULL DEFAULT 1000,
  visual_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  visual_threshold DOUBLE NOT NULL DEFAULT 0.01,
  baseline_image MEDIUMTEXT NULL,
  baseline_hash CHAR(64) NULL,
  last_run_at DATETIME NULL,
  next_run_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_synthetic_tests_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_synthetic_tests_site (site_id),
  INDEX idx_synthetic_tests_schedule (enabled,next_run_at,last_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS synthetic_runs (
  id CHAR(36) PRIMARY KEY,
  test_id CHAR(36) NOT NULL,
  site_id CHAR(36) NOT NULL,
  status VARCHAR(30) NOT NULL,
  duration_ms INT NULL,
  error LONGTEXT NULL,
  result LONGTEXT NULL,
  visual_mismatch DOUBLE NULL,
  screenshot_image MEDIUMTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_synthetic_runs_test FOREIGN KEY (test_id) REFERENCES synthetic_tests(id) ON DELETE CASCADE,
  CONSTRAINT fk_synthetic_runs_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_synthetic_runs_test_created (test_id,created_at),
  INDEX idx_synthetic_runs_site_created (site_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS oauth_clients (
  id CHAR(36) PRIMARY KEY,
  client_id_hash CHAR(64) NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_name VARCHAR(255) NULL,
  client_secret_hash CHAR(64) NULL,
  token_endpoint_auth_method VARCHAR(50) NOT NULL DEFAULT 'none',
  redirect_uris LONGTEXT NOT NULL,
  metadata LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_oauth_clients_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id CHAR(36) PRIMARY KEY,
  code_hash CHAR(64) NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge VARCHAR(191) NOT NULL,
  code_challenge_method VARCHAR(20) NOT NULL DEFAULT 'S256',
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  subject VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_oauth_codes_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id CHAR(36) PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_type VARCHAR(20) NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  subject VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_oauth_tokens_client_created (created_at),
  INDEX idx_oauth_tokens_expires (expires_at),
  INDEX idx_oauth_tokens_type (token_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_type VARCHAR(20) NOT NULL,
  actor VARCHAR(255) NULL,
  client_id VARCHAR(255) NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(255) NOT NULL,
  mcp_tool VARCHAR(100) NULL,
  status_code INT NULL,
  ip VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_log_created (created_at),
  INDEX idx_audit_log_actor (actor_type, actor, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
