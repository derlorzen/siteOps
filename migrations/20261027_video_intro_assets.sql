CREATE TABLE IF NOT EXISTS video_studio_intro_assets (
 id CHAR(36) NOT NULL PRIMARY KEY,
 project_id CHAR(36) NOT NULL,
 name VARCHAR(160) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'uploading',
 metadata JSON NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX video_intro_project(project_id,created_at),
 FOREIGN KEY(project_id) REFERENCES video_studio_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
