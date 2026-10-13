<?php
declare(strict_types=1);
namespace SiteCms;

/** Persistent content and identity state; deployments never replace this store. */
final class Store {
    public readonly \PDO $db;
    public function __construct(string $dsn, ?string $user = null, ?string $password = null) {
        $this->db = new \PDO($dsn, $user, $password, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC]);
        if ($this->db->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            $this->db->exec('PRAGMA busy_timeout=5000');
            $this->db->exec('PRAGMA foreign_keys=ON');
        }
    }
    public function install(): void {
        foreach ([
            'CREATE TABLE IF NOT EXISTS contents (id VARCHAR(64) PRIMARY KEY, type VARCHAR(64) NOT NULL, title VARCHAR(255) NOT NULL, path VARCHAR(450) UNIQUE, status VARCHAR(16) NOT NULL, fields TEXT NOT NULL, seo TEXT NOT NULL, version INTEGER NOT NULL, updated_at VARCHAR(32) NOT NULL)',
            'CREATE TABLE IF NOT EXISTS revisions (id VARCHAR(64) PRIMARY KEY, content_id VARCHAR(64) NOT NULL, version INTEGER NOT NULL, snapshot TEXT NOT NULL, actor VARCHAR(64) NOT NULL, created_at VARCHAR(32) NOT NULL)',
            'CREATE TABLE IF NOT EXISTS users (id VARCHAR(64) PRIMARY KEY, email VARCHAR(190) UNIQUE NOT NULL, name VARCHAR(190) NOT NULL, password_hash VARCHAR(255) NOT NULL, role VARCHAR(64) NOT NULL, grants TEXT NOT NULL, active INTEGER NOT NULL, auth_version INTEGER NOT NULL)',
            'CREATE TABLE IF NOT EXISTS tokens (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, token_hash VARCHAR(64) UNIQUE NOT NULL, label VARCHAR(190) NOT NULL, expires_at VARCHAR(32) NOT NULL)',
            'CREATE TABLE IF NOT EXISTS attempts (bucket VARCHAR(64) PRIMARY KEY, attempts INTEGER NOT NULL, reset_at BIGINT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS changes (id VARCHAR(64) PRIMARY KEY, content_id VARCHAR(64) NOT NULL, actor VARCHAR(64) NOT NULL, base_version INTEGER NOT NULL, payload TEXT NOT NULL, status VARCHAR(16) NOT NULL, expires_at VARCHAR(32) NOT NULL, result TEXT)',
            'CREATE TABLE IF NOT EXISTS media (id VARCHAR(64) PRIMARY KEY, name VARCHAR(190) NOT NULL, mime VARCHAR(100) NOT NULL, filename VARCHAR(100) NOT NULL, bytes BIGINT NOT NULL, actor VARCHAR(64) NOT NULL)',
            'CREATE TABLE IF NOT EXISTS site_state (id VARCHAR(64) PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at VARCHAR(32) NOT NULL)',
            'CREATE TABLE IF NOT EXISTS site_history (id VARCHAR(64) PRIMARY KEY, section VARCHAR(64) NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, actor VARCHAR(64) NOT NULL, created_at VARCHAR(32) NOT NULL)',
            'CREATE TABLE IF NOT EXISTS content_options (content_id VARCHAR(64) PRIMARY KEY, payload TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS site_proposals (id VARCHAR(64) PRIMARY KEY, section VARCHAR(64) NOT NULL, actor VARCHAR(64) NOT NULL, base_version INTEGER NOT NULL, payload TEXT NOT NULL, status VARCHAR(16) NOT NULL, expires_at VARCHAR(32) NOT NULL, result TEXT)',
        ] as $sql) {
            if($this->db->getAttribute(\PDO::ATTR_DRIVER_NAME)==='mysql') {
                $sql=str_replace(' TEXT',' LONGTEXT',str_replace('grants TEXT','`grants` TEXT',$sql)).' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
            }
            $this->db->exec($sql);
        }
    }
    public function query(string $sql, array $parameters = []): \PDOStatement {
        $statement = $this->db->prepare($sql); $statement->execute($parameters); return $statement;
    }
    public function transaction(callable $work): mixed {
        $owner = !$this->db->inTransaction();
        if ($owner) { $this->db->beginTransaction(); }
        try { $result = $work(); if ($owner) { $this->db->commit(); } return $result; }
        catch (\Throwable $error) { if ($owner && $this->db->inTransaction()) { $this->db->rollBack(); } throw $error; }
    }
    public static function id(): string { return bin2hex(random_bytes(16)); }
    public static function json(mixed $value): string { return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
    public static function decode(string $value): array { return json_decode($value, true, 64, JSON_THROW_ON_ERROR); }
}
