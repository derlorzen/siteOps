-- Reusable encrypted SFTP/FTPS/FTP credentials; website directories remain site-specific.
CREATE TABLE IF NOT EXISTS server_connection_profiles (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  protocol ENUM('sftp','ftps','ftp') NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL,
  username VARCHAR(255) NOT NULL,
  encrypted_credentials LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_server_profile_name(name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
