-- Video Studio: separate channels/projects and durable rendering records.
CREATE TABLE IF NOT EXISTS video_studio_projects (
 id CHAR(36) NOT NULL PRIMARY KEY,
 name VARCHAR(120) NOT NULL,
 channel VARCHAR(120) NOT NULL DEFAULT 'Bagisto',
 language VARCHAR(8) NOT NULL DEFAULT 'en',
 voice VARCHAR(64) NOT NULL DEFAULT 'am_michael',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS video_studio_jobs (
 id CHAR(36) NOT NULL PRIMARY KEY,
 project_id CHAR(36) NOT NULL,
 title VARCHAR(200) NOT NULL,
 topic VARCHAR(500) NOT NULL DEFAULT '',
 script LONGTEXT NOT NULL,
 scenes JSON NOT NULL,
 format VARCHAR(16) NOT NULL DEFAULT 'landscape',
 status VARCHAR(24) NOT NULL DEFAULT 'draft',
 runner_job_id VARCHAR(64) NULL,
 result JSON NULL,
 error TEXT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_video_studio_project FOREIGN KEY (project_id) REFERENCES video_studio_projects(id) ON DELETE RESTRICT,
 INDEX idx_video_studio_status (status,created_at),
 INDEX idx_video_studio_project (project_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;