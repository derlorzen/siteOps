CREATE TABLE IF NOT EXISTS cms_project_packages (
  id CHAR(36) PRIMARY KEY,
  digest CHAR(64) NOT NULL UNIQUE,
  manifest LONGTEXT NOT NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'uploading',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS cms_project_files (
  package_id CHAR(36) NOT NULL,
  path_hash CHAR(64) NOT NULL,
  path VARCHAR(240) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  bytes INT UNSIGNED NOT NULL,
  content LONGBLOB NOT NULL,
  PRIMARY KEY (package_id,path_hash),
  CONSTRAINT fk_cms_project_file_package FOREIGN KEY (package_id) REFERENCES cms_project_packages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
