-- A website may be standalone or belong to ONE customer project.
-- Several websites may belong to the same project. Existing site/project metadata remains intact.
CREATE TABLE IF NOT EXISTS project_sites (
 site_id CHAR(36) NOT NULL PRIMARY KEY,
 project_id CHAR(36) NOT NULL,
 linked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_project_sites_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
 CONSTRAINT fk_project_sites_project FOREIGN KEY (project_id) REFERENCES customer_projects(id) ON DELETE CASCADE,
 INDEX idx_project_sites_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Preserve unambiguous associations from the previous one-site-per-project design.
-- Conflicting legacy associations intentionally remain unassigned for manual review.
INSERT IGNORE INTO project_sites(site_id,project_id)
 SELECT site_id,MIN(id) FROM customer_projects
 WHERE site_id IS NOT NULL
 GROUP BY site_id HAVING COUNT(*)=1;
