-- Video-Autopilot: ein Lauf führt von der Idee über Storyboard und Bildschirmaufnahmen bis zum
-- gerenderten Video. Der Zustand liegt in der Datenbank, damit Läufe Neustarts und Reloads überstehen.
CREATE TABLE IF NOT EXISTS video_autopilot_runs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL,
  stage VARCHAR(20) NOT NULL,
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,
  state MEDIUMTEXT NOT NULL,
  job_id CHAR(36) NULL,
  error VARCHAR(600) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY video_autopilot_project (project_id, created_at),
  KEY video_autopilot_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
