CREATE TABLE IF NOT EXISTS search_console_accounts (
 id CHAR(36) NOT NULL PRIMARY KEY, subject VARCHAR(200) NOT NULL, google_id VARCHAR(200) NOT NULL,
 email VARCHAR(254) NOT NULL, encrypted_credentials LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY idx_gsc_owner(subject,google_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS search_console_states (
 state_hash CHAR(64) NOT NULL PRIMARY KEY, encrypted_payload LONGTEXT NOT NULL, expires_at DATETIME(3) NOT NULL,
 INDEX idx_gsc_state_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS search_console_sites (
 site_id CHAR(36) NOT NULL PRIMARY KEY, account_id CHAR(36) NOT NULL, property VARCHAR(500) NOT NULL,
 domain VARCHAR(253) NOT NULL, revision CHAR(36) NOT NULL, live_approved_at DATETIME(3) NULL,
 verified_at DATETIME(3) NULL, permission_level VARCHAR(40) NULL, sitemap_url VARCHAR(2000) NULL,
 sitemap_status VARCHAR(30) NOT NULL DEFAULT 'not_submitted', last_sync_at DATETIME(3) NULL,
 last_complete_date DATE NULL, next_sync_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 sync_lease_until DATETIME(3) NULL, sync_lease_token CHAR(36) NULL, sync_error VARCHAR(300) NULL,
 CONSTRAINT fk_gsc_site FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
 CONSTRAINT fk_gsc_account FOREIGN KEY(account_id) REFERENCES search_console_accounts(id) ON DELETE CASCADE,
 INDEX idx_gsc_sync(next_sync_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS search_console_previews (
 token_hash CHAR(64) NOT NULL PRIMARY KEY, site_id CHAR(36) NOT NULL, encrypted_payload LONGTEXT NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'pending', result JSON NULL, error VARCHAR(300) NULL,
 expires_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_gsc_preview_site FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
 INDEX idx_gsc_preview_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS search_console_reports (
 site_id CHAR(36) NOT NULL PRIMARY KEY, revision CHAR(36) NOT NULL, report JSON NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_gsc_report_site FOREIGN KEY(site_id) REFERENCES search_console_sites(site_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS search_console_inspections (
 property_hash CHAR(64) NOT NULL, quota_date DATE NOT NULL, used INT NOT NULL DEFAULT 0,
 PRIMARY KEY(property_hash,quota_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
