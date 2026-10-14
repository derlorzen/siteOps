<?php
declare(strict_types=1);
namespace SiteCms;

final class Access {
    public function __construct(private Store $store, public readonly array $roles) {}
    public function user(string $id): ?array {
        $user = $this->store->query('SELECT * FROM users WHERE id=? AND active=1', [$id])->fetch();
        if (!$user) { return null; } $user['grants'] = Store::decode($user['grants']);$user['auth_version']=(int)$user['auth_version']; return $user;
    }
    public function can(array $user, string $action, ?array $content = null): bool {
        $role = $this->roles[$user['role']] ?? [];
        if (!in_array($action, $role['capabilities'] ?? [], true)) { return false; }
        if ($content && !($role['all_content'] ?? false)) { return in_array($content['id'], $user['grants'], true); }
        return true;
    }
    public function require(array $user, string $action, ?array $content = null): void {
        if (!$this->can($user, $action, $content)) { throw new HttpError(403, 'Für diese Aktion fehlen dir die Rechte.'); }
    }
    public function create(string $email, string $name, string $password, string $role, array $grants = []): string {
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email)>190 || trim($name)==='' || mb_strlen($name)>190 || strlen($password)<12 || strlen($password)>72 || !isset($this->roles[$role])) { throw new HttpError(422, 'E-Mail, Name, Rolle und Passwort (12 bis 72 Bytes) prüfen.'); }
        foreach ($grants as $grant) { if (!is_string($grant) || !$this->store->query('SELECT id FROM contents WHERE id=?', [$grant])->fetch()) { throw new HttpError(422, 'Unbekannte Inhaltszuordnung.'); } }
        $id = Store::id();
        try { $this->store->query('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)', [$id,strtolower($email),trim($name),password_hash($password,PASSWORD_DEFAULT),$role,Store::json(array_values($grants)),1,1]); }
        catch (\PDOException $error) { if ((string)$error->getCode()==='23000' || str_contains($error->getMessage(),'UNIQUE')) { throw new HttpError(409,'Diese E-Mail existiert bereits.'); } throw $error; }
        return $id;
    }
    public function update(array $actor,string $id,string $name,string $role,array $grants,bool $active,string $password=''):void {
        $this->require($actor,'users');
        if(trim($name)==='' || mb_strlen($name)>190 || !isset($this->roles[$role]) || ($password!=='' && (strlen($password)<12 || strlen($password)>72))) {throw new HttpError(422,'Name, Rolle oder Passwort prüfen.');}
        foreach($grants as $grant){if(!is_string($grant) || !$this->store->query('SELECT id FROM contents WHERE id=?',[$grant])->fetch()){throw new HttpError(422,'Unbekannte Inhaltszuordnung.');}}
        $this->store->transaction(function()use($actor,$id,$name,$role,$grants,$active,$password):void {
            // Serialize small user administration to preserve at least one active administrator.
            $this->store->query('UPDATE users SET active=active');
            $existing=$this->store->query('SELECT * FROM users WHERE id=?',[$id])->fetch() ?: throw new HttpError(404,'Benutzer nicht gefunden.');
            if($id===$actor['id'] && (!$active || $role!==$existing['role'])) {throw new HttpError(422,'Die eigene Rolle und Aktivierung können hier nicht geändert werden.');}
            $administrators=array_filter($this->store->query('SELECT id,role FROM users WHERE active=1')->fetchAll(),fn($user)=>in_array('users',$this->roles[$user['role']]['capabilities'] ?? [],true));
            if($existing['active'] && in_array('users',$this->roles[$existing['role']]['capabilities'] ?? [],true) && (!$active || !in_array('users',$this->roles[$role]['capabilities'] ?? [],true)) && count($administrators)<2){throw new HttpError(422,'Mindestens ein aktiver Administrator muss erhalten bleiben.');}
            $hash=$password!==''?password_hash($password,PASSWORD_DEFAULT):$existing['password_hash'];
            $this->store->query('UPDATE users SET name=?,role=?,`grants`=?,active=?,password_hash=?,auth_version=auth_version+1 WHERE id=?',[trim($name),$role,Store::json(array_values($grants)),(int)$active,$hash,$id]);
            $this->store->query('DELETE FROM tokens WHERE user_id=?',[$id]);
        });
    }
    public function attempt(string $email, string $password, string $ip): ?array {
        $email = strtolower(trim($email));
        $buckets = [hash('sha256','ip:' . $ip),hash('sha256','email:' . $email)];
        $this->store->transaction(function () use ($buckets): void {
            foreach ($buckets as $bucket) {
                $row = $this->store->query('SELECT * FROM attempts WHERE bucket=?',[$bucket])->fetch();
                if (!$row) { $this->store->query('INSERT INTO attempts VALUES (?,?,?)',[$bucket,0,time()+900]); }
                elseif ((int)$row['reset_at'] < time()) { $this->store->query('UPDATE attempts SET attempts=0,reset_at=? WHERE bucket=?',[time()+900,$bucket]); }
                $updated = $this->store->query('UPDATE attempts SET attempts=attempts+1 WHERE bucket=? AND attempts<10',[$bucket])->rowCount();
                if (!$updated) { throw new HttpError(429,'Zu viele Anmeldeversuche. Bitte später erneut versuchen.'); }
            }
        });
        $row = $this->store->query('SELECT id,password_hash FROM users WHERE email=? AND active=1',[$email])->fetch();
        $hash = $row['password_hash'] ?? '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi';
        if (!password_verify($password,$hash) || !$row) { return null; }
        return $this->user($row['id']);
    }
    public function session(): void {
        if (session_status() === PHP_SESSION_ACTIVE) { return; }
        ini_set('session.use_strict_mode','1'); ini_set('session.use_only_cookies','1');
        session_name('sitecms'); session_set_cookie_params(['httponly'=>true,'secure'=>($_SERVER['HTTPS'] ?? '') === 'on','samesite'=>'Strict','path'=>'/']);
        session_start();
        if (isset($_SESSION['seen']) && $_SESSION['seen'] < time()-3600) { $_SESSION = []; session_regenerate_id(true); }
        $_SESSION['seen'] = time(); $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    }
    public function csrf(string $value): void { if (!isset($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'],$value)) { throw new HttpError(403,'Das Formular ist abgelaufen. Bitte neu laden.'); } }
    public function current(): ?array {
        $this->session(); $user = isset($_SESSION['uid']) ? $this->user($_SESSION['uid']) : null;
        return $user && $user['auth_version'] === ($_SESSION['auth_version'] ?? null) ? $user : null;
    }
    public function login(array $user): void { $this->session(); session_regenerate_id(true); $_SESSION=['uid'=>$user['id'],'auth_version'=>$user['auth_version'],'csrf'=>bin2hex(random_bytes(32)),'seen'=>time()]; }
    public function token(string $userId, string $label): string {
        if (!$this->user($userId)) { throw new HttpError(404,'Unbekannter Benutzer.'); }
        $token=bin2hex(random_bytes(32)); $this->store->query('INSERT INTO tokens VALUES (?,?,?,?,?)',[Store::id(),$userId,hash('sha256',$token),$label,gmdate('c',time()+86400*90)]); return $token;
    }
    public function bearer(string $token): ?array {
        $row=$this->store->query('SELECT user_id FROM tokens WHERE token_hash=? AND expires_at>?',[hash('sha256',$token),gmdate('c')])->fetch();
        return $row ? $this->user($row['user_id']) : null;
    }
}
