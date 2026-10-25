-- Browser dashboard login sessions; never store bearer cookie values or plaintext passwords.
CREATE TABLE IF NOT EXISTS dashboard_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  subject VARCHAR(191) NOT NULL,
  credential_revision CHAR(43) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  INDEX idx_dashboard_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;