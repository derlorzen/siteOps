CREATE TABLE IF NOT EXISTS coolify_connections (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  base_url VARCHAR(512) NOT NULL,
  encrypted_token LONGTEXT NOT NULL,
  default_server_uuid VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coolify_supabase_instances (
  id CHAR(36) NOT NULL PRIMARY KEY,
  connection_id CHAR(36) NOT NULL,
  project_key VARCHAR(100) NOT NULL,
  name VARCHAR(190) NOT NULL,
  siteops_project_id CHAR(36) NULL,
  coolify_project_uuid VARCHAR(191) NULL,
  environment_name VARCHAR(100) NOT NULL DEFAULT 'production',
  server_uuid VARCHAR(191) NULL,
  service_uuid VARCHAR(191) NULL,
  state VARCHAR(40) NOT NULL DEFAULT 'queued',
  last_error VARCHAR(450) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_coolify_project_key (connection_id,project_key),
  KEY idx_coolify_supabase_state (state,created_at),
  KEY idx_coolify_supabase_siteops_project (siteops_project_id),
  CONSTRAINT fk_coolify_supabase_connection FOREIGN KEY (connection_id)
    REFERENCES coolify_connections(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
