-- Personal and third-party tool bookmarks, optionally linked to an existing SiteOps customer project.
CREATE TABLE IF NOT EXISTS tool_links (
  id CHAR(36) NOT NULL PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  url VARCHAR(700) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  category VARCHAR(60) NOT NULL DEFAULT 'Allgemein',
  origin VARCHAR(16) NOT NULL DEFAULT 'own',
  project_id CHAR(36) NULL,
  favorite TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tool_links_project FOREIGN KEY (project_id) REFERENCES customer_projects(id) ON DELETE SET NULL,
  INDEX idx_tool_links_project(project_id),
  INDEX idx_tool_links_category(category),
  INDEX idx_tool_links_favorite(favorite)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
