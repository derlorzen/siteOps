CREATE TABLE IF NOT EXISTS jarvis_projects (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_key CHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY jarvis_projects_owner (owner_key, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jarvis_chats (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_key CHAR(64) NOT NULL,
  project_key VARCHAR(44) NOT NULL,
  title VARCHAR(100) NOT NULL DEFAULT 'Neuer Chat',
  messages_json LONGTEXT NOT NULL,
  recommendations_json TEXT NULL,
  model_id VARCHAR(40) NULL,
  phase VARCHAR(16) NOT NULL DEFAULT 'idle',
  partial_answer MEDIUMTEXT NULL,
  run_id CHAR(36) NULL,
  run_until DATETIME(3) NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY jarvis_chats_owner (owner_key, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jarvis_push_subscriptions (
  owner_key CHAR(64) NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  subscription_json TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (owner_key, endpoint_hash),
  KEY jarvis_push_recent (owner_key, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
