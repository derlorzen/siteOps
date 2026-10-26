CREATE TABLE IF NOT EXISTS video_suite_chat_images (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  mime_type VARCHAR(40) NOT NULL,
  image MEDIUMBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX video_chat_image_project (project_id,created_at),
  FOREIGN KEY (project_id) REFERENCES video_studio_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
