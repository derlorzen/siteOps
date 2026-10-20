CREATE TABLE IF NOT EXISTS coolify_commands (
  id CHAR(36) NOT NULL PRIMARY KEY,
  connection_id CHAR(36) NOT NULL,
  application_uuid VARCHAR(191) NOT NULL,
  command_key VARCHAR(50) NOT NULL,
  label VARCHAR(190) NOT NULL,
  command VARCHAR(300) NOT NULL,
  container VARCHAR(190) NULL,
  allow_args TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_coolify_command (connection_id,application_uuid,command_key),
  CONSTRAINT fk_coolify_command_connection FOREIGN KEY (connection_id)
    REFERENCES coolify_connections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coolify_command_runs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  connection_id CHAR(36) NOT NULL,
  application_uuid VARCHAR(191) NOT NULL,
  command_key VARCHAR(50) NOT NULL,
  arg_count INT NOT NULL DEFAULT 0,
  state VARCHAR(40) NOT NULL DEFAULT 'started',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_coolify_command_runs (connection_id,application_uuid,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
