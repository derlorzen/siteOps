// Adds columns that were introduced after the initial schema: Git deployment
// mode, extended monitor options and the richer SEO crawl fields. Uses
// ensureColumn (checks information_schema before altering) instead of plain
// ALTER TABLE so this migration stays safe to run against databases that
// already have these columns from the pre-migrations version of SiteOps.
export default async function run({ ensureColumn }) {
  await ensureColumn('sites', 'deployment_mode', "VARCHAR(30) NOT NULL DEFAULT 'webspace'");
  await ensureColumn('sites', 'source_repository', 'VARCHAR(255) NULL');
  await ensureColumn('sites', 'source_branch', 'VARCHAR(191) NULL');
  await ensureColumn('sites', 'source_root', 'TEXT NULL');
  await ensureColumn('sites', 'git_credentials', 'LONGTEXT NULL');
  await ensureColumn('sites', 'hostinger_target_directory', 'TEXT NULL');
  await ensureColumn('sites', 'monitor_expected_title', 'TEXT NULL');
  await ensureColumn('sites', 'monitor_check_dns', 'BOOLEAN NOT NULL DEFAULT TRUE');
  await ensureColumn('sites', 'monitor_check_wordpress', 'BOOLEAN NOT NULL DEFAULT FALSE');
  await ensureColumn('sites', 'alert_repeat_minutes', 'INT NOT NULL DEFAULT 60');
  await ensureColumn('monitor_state', 'last_alert_at', 'DATETIME NULL');
  await ensureColumn('monitor_state', 'alert_count', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('seo_pages', 'final_url', 'TEXT NULL');
  await ensureColumn('seo_pages', 'redirect_count', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('seo_pages', 'lang', 'VARCHAR(50) NULL');
  await ensureColumn('seo_pages', 'hreflang', 'LONGTEXT NULL');
  await ensureColumn('seo_pages', 'social', 'LONGTEXT NULL');
  await ensureColumn('seo_pages', 'security', 'LONGTEXT NULL');
  await ensureColumn('seo_pages', 'accessibility', 'LONGTEXT NULL');
  await ensureColumn('seo_pages', 'content_hash', 'CHAR(64) NULL');
  await ensureColumn('seo_pages', 'content_fingerprint', 'LONGTEXT NULL');
  await ensureColumn('seo_pages', 'indexable', 'BOOLEAN NOT NULL DEFAULT TRUE');
  await ensureColumn('synthetic_tests', 'next_run_at', 'DATETIME NULL');
}
