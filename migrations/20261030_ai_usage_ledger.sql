CREATE TABLE IF NOT EXISTS ai_usage_policy (
 id INT PRIMARY KEY,
 monthly_calls INT NOT NULL DEFAULT 200,
 monthly_tokens BIGINT NOT NULL DEFAULT 2000000,
 monthly_usd DECIMAL(12,6) NULL,
 prices_json JSON NOT NULL
);
INSERT IGNORE INTO ai_usage_policy(id,prices_json) VALUES(1,'{}');
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
 id CHAR(36) PRIMARY KEY,
 operation VARCHAR(100) NOT NULL,
 model VARCHAR(100) NOT NULL,
 state VARCHAR(24) NOT NULL,
 input_tokens BIGINT NULL,
 output_tokens BIGINT NULL,
 accounted_tokens BIGINT NOT NULL,
 estimated_usd DECIMAL(14,6) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX ai_usage_month(created_at)
);
