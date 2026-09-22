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
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  backup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  backup_interval_seconds INT NOT NULL DEFAULT 86400,
  backup_max_files INT NOT NULL DEFAULT 10000,
  monitor_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  monitor_url TEXT NULL,
  monitor_interval_seconds INT NOT NULL DEFAULT 60,
  monitor_expected_status INT NOT NULL DEFAULT 200,
  monitor_content TEXT NULL,
  monitor_timeout_ms INT NOT NULL DEFAULT 10000,
  monitor_failure_threshold INT NOT NULL DEFAULT 3,
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
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
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
