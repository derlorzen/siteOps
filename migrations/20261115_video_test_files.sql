-- Testdateien für Upload-Schritte in Demo-Aufnahmen (z. B. eine Beispiel-Extension als ZIP).
CREATE TABLE IF NOT EXISTS video_test_files (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  data LONGBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY video_test_files_sha (sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
