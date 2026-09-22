create extension if not exists pgcrypto;
create table if not exists sites(
 id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null, domain text not null,
 protocol text not null check(protocol in('sftp','ftps','ftp')), host text not null, port int not null, username text not null,
 encrypted_credentials text not null, remote_root text not null, site_type text not null default 'php', enabled boolean not null default true,
 backup_enabled boolean not null default true, backup_interval_seconds int not null default 86400, backup_max_files int not null default 10000,
 monitor_enabled boolean not null default true, monitor_url text,
 monitor_interval_seconds int not null default 60, monitor_expected_status int not null default 200, monitor_content text,
 monitor_timeout_ms int not null default 10000, monitor_failure_threshold int not null default 3, response_warn_ms int,
 ssl_warn_days int not null default 14, exclude_patterns jsonb not null default '[".git","node_modules","wp-content/cache","wp-content/uploads"]',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists change_previews(
 id uuid primary key default gen_random_uuid(), site_id uuid not null references sites(id) on delete cascade,
 description text not null, actor text not null, changes jsonb not null, validation jsonb,
 status text not null default 'pending', expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists changes(
 id uuid primary key default gen_random_uuid(), site_id uuid not null references sites(id) on delete cascade,
 preview_id uuid references change_previews(id), description text not null, actor text not null,
 files jsonb not null default '[]', pre_commit text, post_commit text, status text not null,
 health_result jsonb, created_at timestamptz not null default now()
);
create table if not exists backups(
 id uuid primary key default gen_random_uuid(), site_id uuid not null references sites(id) on delete cascade,
 git_commit text not null, backup_type text not null, file_count int, changed boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists monitor_checks(
 id bigserial primary key, site_id uuid not null references sites(id) on delete cascade,
 ok boolean not null, http_status int, response_ms int, ssl_days int, error text, details jsonb,
 created_at timestamptz not null default now()
);
create index if not exists idx_monitor_checks_site_created on monitor_checks(site_id,created_at desc);
create table if not exists incidents(
 id uuid primary key default gen_random_uuid(), site_id uuid not null references sites(id) on delete cascade,
 status text not null default 'open', title text not null, details jsonb,
 created_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists monitor_state(
 site_id uuid primary key references sites(id) on delete cascade, consecutive_failures int not null default 0,
 last_check_at timestamptz, last_ok_at timestamptz, incident_id uuid references incidents(id)
);

-- Forward-compatible migrations for existing installations.
alter table sites add column if not exists backup_interval_seconds int not null default 86400;
alter table sites add column if not exists backup_max_files int not null default 10000;

create table if not exists backup_state(
 site_id uuid primary key references sites(id) on delete cascade,
 last_attempt_at timestamptz,
 last_success_at timestamptz,
 last_error text,
 updated_at timestamptz not null default now()
);
