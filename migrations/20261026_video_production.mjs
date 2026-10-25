export default async function migrateVideoProduction({ ensureColumn, q }) {
  await ensureColumn('video_studio_jobs', 'render_settings', 'JSON NULL');
  await ensureColumn('video_studio_jobs', 'youtube_metadata', 'JSON NULL');
  await q(`CREATE TABLE IF NOT EXISTS video_studio_demo_templates (
    id CHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(120) NOT NULL, language VARCHAR(8) NOT NULL,
    scene JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
