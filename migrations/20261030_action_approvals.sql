CREATE TABLE IF NOT EXISTS action_approvals (
  id CHAR(36) PRIMARY KEY,
  actor_key CHAR(64) NOT NULL,
  actor_subject VARCHAR(255) NOT NULL,
  tool_name VARCHAR(128) NOT NULL,
  arguments_enc LONGTEXT NOT NULL,
  arguments_hash CHAR(64) NOT NULL,
  state_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  expires_at DATETIME(3) NOT NULL,
  approved_by VARCHAR(255) NULL,
  approved_at DATETIME NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX action_approval_pending(status,expires_at)
);
