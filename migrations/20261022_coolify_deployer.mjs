export default async function ({ q, ensureColumn }) {
  await q(`CREATE TABLE IF NOT EXISTS coolify_deployments (
    id CHAR(36) PRIMARY KEY,
    connection_id CHAR(36) NOT NULL,
    domain VARCHAR(253) NOT NULL,
    config_hash CHAR(64) NOT NULL,
    encrypted_config LONGTEXT NOT NULL,
    plan LONGTEXT NOT NULL,
    progress LONGTEXT NOT NULL,
    state VARCHAR(40) NOT NULL DEFAULT 'planned',
    resource_uuid VARCHAR(191) NULL,
    resource_kind VARCHAR(20) NOT NULL DEFAULT 'application',
    project_uuid VARCHAR(191) NULL,
    siteops_project_id CHAR(36) NULL,
    site_id CHAR(36) NULL,
    deployment_uuid VARCHAR(191) NULL,
    deploy_requested_at DATETIME(3) NULL,
    approved_at DATETIME(3) NULL,
    expires_at DATETIME(3) NOT NULL,
    last_success_at DATETIME(3) NULL,
    last_error VARCHAR(450) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uniq_coolify_deployment_domain(domain),
    KEY idx_coolify_deployment_state(state,updated_at),
    CONSTRAINT fk_coolify_deployment_connection FOREIGN KEY(connection_id)
      REFERENCES coolify_connections(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  for (const [name, definition] of Object.entries({
    coolify_deployment_id: 'CHAR(36) NULL UNIQUE',
    coolify_connection_id: 'CHAR(36) NULL',
    coolify_project_uuid: 'VARCHAR(191) NULL',
    coolify_application_uuid: 'VARCHAR(191) NULL',
    coolify_server_uuid: 'VARCHAR(191) NULL',
    coolify_resource_kind: 'VARCHAR(20) NULL',
    coolify_build_method: 'VARCHAR(30) NULL',
    deployment_status: 'VARCHAR(40) NULL',
    last_deployed_at: 'DATETIME(3) NULL'
  }))
    await ensureColumn('sites', name, definition);
}
