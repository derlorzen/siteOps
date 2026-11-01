CREATE TABLE IF NOT EXISTS video_studio_final_assets (
  revision BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id CHAR(36) NOT NULL UNIQUE,
  job_id CHAR(36) NOT NULL,
  filename VARCHAR(160) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  duration_seconds DOUBLE NOT NULL,
  body MEDIUMBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY job_checksum (job_id, sha256),
  KEY job_revision (job_id, revision),
  FOREIGN KEY (job_id) REFERENCES video_studio_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
