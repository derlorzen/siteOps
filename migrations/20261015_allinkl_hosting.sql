CREATE TABLE IF NOT EXISTS hosting_accounts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  login VARCHAR(120) NOT NULL,
  server_profile_id CHAR(36) NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hosting_provider_login (provider, login),
  KEY idx_hosting_server_profile (server_profile_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
