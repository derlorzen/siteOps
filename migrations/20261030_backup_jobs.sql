CREATE TABLE IF NOT EXISTS backup_jobs (
 id CHAR(36) PRIMARY KEY,
 site_id CHAR(36) NOT NULL,
 idempotency_hash CHAR(64) NOT NULL UNIQUE,
 state VARCHAR(24) NOT NULL,
 phase VARCHAR(300) NOT NULL,
 worker_id CHAR(36) NULL,
 result_json JSON NULL,
 error_json JSON NULL,
 heartbeat_at DATETIME NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at DATETIME NULL,
 INDEX backup_job_site(site_id,created_at)
);
