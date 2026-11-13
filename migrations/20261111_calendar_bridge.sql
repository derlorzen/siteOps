-- Kalender-Brücke: eine Konfiguration (id=1) mit verschlüsselter Quelladresse,
-- geheimem Feed-Token und dem zuletzt erzeugten, bereinigten iCal-Feed.
CREATE TABLE IF NOT EXISTS calendar_bridge (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  source_url_encrypted TEXT NULL,
  feed_token_encrypted TEXT NOT NULL,
  feed_token_hash CHAR(64) NOT NULL,
  uid_salt CHAR(32) NOT NULL,
  calendar_name VARCHAR(80) NOT NULL,
  replacement_title VARCHAR(120) NOT NULL,
  exclude_prefix VARCHAR(20) NOT NULL DEFAULT '',
  keep_all_day_titles TINYINT(1) NOT NULL DEFAULT 1,
  office_address VARCHAR(200) NOT NULL DEFAULT '',
  office_label VARCHAR(60) NOT NULL DEFAULT '',
  past_days INT UNSIGNED NOT NULL DEFAULT 30,
  refresh_minutes INT UNSIGNED NOT NULL DEFAULT 15,
  cached_ics MEDIUMTEXT NULL,
  cached_at DATETIME(3) NULL,
  last_error VARCHAR(300) NULL,
  last_result MEDIUMTEXT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
