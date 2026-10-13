<?php
declare(strict_types=1);
ini_set('display_errors','0');
// Deployment-only endpoint; secrets and database snapshots stay outside public/.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store'); header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');
$root = dirname(__DIR__);
$lock = null;
function cmsAgentFail(int $status, string $message): never {
    throw new CmsAgentError($message,$status);
}
final class CmsAgentError extends RuntimeException {}
function cmsAgentJson(string $path): array {
    return json_decode((string)file_get_contents($path), true, 64, JSON_THROW_ON_ERROR);
}
function cmsAgentAtomic(string $path, string $value): void {
    $tmp = $path.'.'.bin2hex(random_bytes(8)).'.tmp';
    if (file_put_contents($tmp, $value, LOCK_EX) === false) { throw new RuntimeException('write'); }
    chmod($tmp, 0600);
    if (!rename($tmp, $path)) { @unlink($tmp); throw new RuntimeException('rename'); }
}
function cmsAgentVersion(mixed $version): string {
    if (!is_string($version) || !preg_match('/^(?:\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?|legacy-[a-f0-9]{12})$/D', $version)) { cmsAgentFail(422, 'Ungültige Version.'); }
    return $version;
}
function cmsAgentVerify(string $root, string $version, string $digest): array {
    $dir = $root.'/.lorzcms/releases/'.$version;
    $raw = file_get_contents($dir.'/manifest.json');
    if (!is_string($raw) || !hash_equals(hash('sha256', $raw), $digest)) { cmsAgentFail(422, 'Paket-Prüfsumme stimmt nicht.'); }
    $manifest = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (($manifest['version'] ?? '') !== $version || ($manifest['schemaVersion'] ?? null) !== 1 || !in_array(1, $manifest['compatibleSchemas'] ?? [], true)) { cmsAgentFail(422, 'Nicht unterstützte Datenbankversion.'); }
    if (version_compare(PHP_VERSION, $manifest['minPhp'] ?? '8.3', '<')) { cmsAgentFail(422, 'PHP-Version zu alt.'); }
    foreach (['pdo','dom','mbstring','fileinfo'] as $extension) { if (!extension_loaded($extension)) { cmsAgentFail(422, 'PHP-Erweiterung fehlt: '.$extension); } }
    if (!is_array($manifest['files'] ?? null) || count($manifest['files']) > 500) { cmsAgentFail(422, 'Ungültiges Paket.'); }
    $paths = [];
    foreach ($manifest['files'] as $file) {
        $path = $file['path'] ?? '';
        if (!is_string($path) || str_contains($path, '..') || !preg_match('~^(?:src/[a-zA-Z0-9_/-]+\.php|runtime/(?:bootstrap|index)\.php|assets/(?:[a-zA-Z0-9._-]+\.(?:css|js|svg|txt)|fonts/[a-zA-Z0-9._-]+\.(?:woff2?|ttf|txt)))$~D', $path) || isset($paths[$path])) { cmsAgentFail(422, 'Unzulässiger Paketpfad.'); }
        $paths[$path] = true;
        $resolved = realpath($dir.'/'.$path);
        if (!$resolved || !str_starts_with(str_replace('\\','/',$resolved), str_replace('\\','/',realpath($dir)).'/') || !is_file($resolved) || !hash_equals($file['sha256'], hash_file('sha256', $resolved))) { cmsAgentFail(422, 'Datei-Prüfsumme stimmt nicht.'); }
        if (str_ends_with($path, '.php')) { token_get_all((string)file_get_contents($resolved), TOKEN_PARSE); }
    }
    foreach (['src/Store.php','src/Access.php','src/Admin.php','src/Content.php','runtime/bootstrap.php','runtime/index.php'] as $required) { if (!isset($paths[$required])) { cmsAgentFail(422, 'Paket unvollständig.'); } }
    return $manifest;
}
function cmsAgentBackup(string $root, string $job, PDO $db): string {
    $dir = $root.'/.lorzcms/backups/'.$job;
    if (!is_dir($dir)) { mkdir($dir, 0700, true); }
    if (is_file($dir.'/complete.json')) { return $job; }
    copy($root.'/config/local.php', $dir.'/local.php'); chmod($dir.'/local.php', 0600);
    $engine = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
    if ($engine === 'sqlite') {
        if (is_file($dir.'/database.sqlite')) { unlink($dir.'/database.sqlite'); }
        $db->exec('VACUUM INTO '.$db->quote($dir.'/database.sqlite'));
        chmod($dir.'/database.sqlite', 0600);
    } elseif ($engine === 'mysql') {
        $tmp = $dir.'/database.sql.tmp'; $out = fopen($tmp, 'wb');
        if (!$out) { throw new RuntimeException('backup'); }
        $db->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $db->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT');
        try {
            if (fwrite($out, "SET FOREIGN_KEY_CHECKS=0;\n") === false) { throw new RuntimeException('backup'); }
            $tables = $db->query('SHOW FULL TABLES WHERE Table_type = \'BASE TABLE\'')->fetchAll(PDO::FETCH_COLUMN);
            foreach ($tables as $table) {
                $quoted = '`'.str_replace('`','``',$table).'`';
                $create = $db->query('SHOW CREATE TABLE '.$quoted)->fetch(PDO::FETCH_NUM)[1];
                if (fwrite($out, 'DROP TABLE IF EXISTS '.$quoted.";\n".$create.";\n") === false) { throw new RuntimeException('backup'); }
                $rows = $db->query('SELECT * FROM '.$quoted);
                while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                    $columns = array_map(static fn($key)=>'`'.str_replace('`','``',$key).'`',array_keys($row));
                    $values = array_map(static fn($value)=>$value === null ? 'NULL' : "X'".bin2hex((string)$value)."'", array_values($row));
                    if (fwrite($out, 'INSERT INTO '.$quoted.' ('.implode(',',$columns).') VALUES ('.implode(',',$values).");\n") === false) { throw new RuntimeException('backup'); }
                }
            }
            if (fwrite($out, "SET FOREIGN_KEY_CHECKS=1;\n") === false) { throw new RuntimeException('backup'); } $db->commit();
        } catch (Throwable $error) { if ($db->inTransaction()) { $db->rollBack(); } throw $error; }
        finally { fclose($out); }
        chmod($tmp, 0600); if (!rename($tmp, $dir.'/database.sql')) { throw new RuntimeException('backup'); }
    } else { throw new RuntimeException('database'); }
    cmsAgentAtomic($dir.'/complete.json', json_encode(['engine'=>$engine,'createdAt'=>gmdate('c')],JSON_THROW_ON_ERROR));
    return $job;
}
try {
    $configurationPath = $root.'/config/siteops.php';
    if (!is_file($configurationPath)) { cmsAgentFail(404, 'Anschluss nicht eingerichtet.'); }
    $agent = require $configurationPath;
    if (realpath($_SERVER['DOCUMENT_ROOT'] ?? '') !== realpath($root.'/public')) { cmsAgentFail(422, 'Das Domain-Ziel muss auf den public-Unterordner zeigen.'); }
    $localAllowed = ($agent['allow_local_http'] ?? false) && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1','::1'], true);
    if (($_SERVER['HTTPS'] ?? '') !== 'on' && !$localAllowed) { cmsAgentFail(403, 'HTTPS erforderlich.'); }
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer ([a-f0-9]{64})$/D', $authorization, $token) || !hash_equals($agent['key_hash'], hash('sha256',$token[1]))) { cmsAgentFail(401, 'Zugang abgelehnt.'); }
    $statePath = $root.'/.lorzcms/active.json';
    $state = is_file($statePath) ? cmsAgentJson($statePath) : null;
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        echo json_encode(['instanceId'=>$agent['instance_id'],'version'=>$state['version'] ?? null,'jobId'=>$state['jobId'] ?? null,'schemaVersion'=>1,'php'=>PHP_VERSION,'installed'=>is_file($root.'/config/local.php'),'maintenance'=>is_file($root.'/.lorzcms/maintenance')],JSON_THROW_ON_ERROR); return;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { cmsAgentFail(405, 'Methode nicht erlaubt.'); }
    if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) { cmsAgentFail(415, 'JSON erforderlich.'); }
    $raw = file_get_contents('php://input',false,null,0,65537);
    if (strlen($raw) > 65536) { cmsAgentFail(413, 'Anfrage zu groß.'); }
    $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    $action = $body['action'] ?? '';
    if (!in_array($action, ['preflight','provision','activate'], true)) { cmsAgentFail(422, 'Aktion nicht unterstützt.'); }
    $version = cmsAgentVersion($body['version'] ?? null);
    $digest = $body['digest'] ?? '';
    $manifest = cmsAgentVerify($root,$version,$digest);
    if ($action === 'preflight') { echo json_encode(['ok'=>true,'version'=>$version,'schemaVersion'=>1],JSON_THROW_ON_ERROR); return; }
    $job = $body['jobId'] ?? '';
    if (!is_string($job) || !preg_match('/^[a-zA-Z0-9-]{1,80}$/D',$job)) { cmsAgentFail(422, 'Ungültiger Auftrag.'); }
    $lock = fopen($root.'/.lorzcms/deploy.lock','c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { cmsAgentFail(409, 'Ein Update läuft bereits.'); }
    if (!is_dir($root.'/.lorzcms/jobs')) { mkdir($root.'/.lorzcms/jobs',0700,true); }
    $journal = $root.'/.lorzcms/jobs/'.$job.'.json';
    $requestHash = hash('sha256', $raw);
    if (is_file($journal)) {
        $completed = cmsAgentJson($journal);
        if (!hash_equals($completed['requestHash'],$requestHash)) { cmsAgentFail(409, 'Auftrags-ID wurde bereits anders verwendet.'); }
        echo json_encode($completed['result'],JSON_THROW_ON_ERROR); return;
    }
    $progressPath = $root.'/.lorzcms/jobs/'.$job.'.pending.json';
    if (is_file($progressPath) && !hash_equals(cmsAgentJson($progressPath)['requestHash'],$requestHash)) { cmsAgentFail(409,'Auftrag wurde mit anderen Parametern wiederholt.'); }
    if (!is_file($progressPath)) { cmsAgentAtomic($progressPath,json_encode(['requestHash'=>$requestHash],JSON_THROW_ON_ERROR)); }
    if ($action === 'provision') {
        $baseUrl = $body['baseUrl'] ?? '';
        if (!is_string($baseUrl) || !filter_var($baseUrl,FILTER_VALIDATE_URL) || parse_url($baseUrl,PHP_URL_SCHEME) !== 'https' || (parse_url($baseUrl,PHP_URL_PATH) ?: '/') !== '/' || parse_url($baseUrl,PHP_URL_USER) || parse_url($baseUrl,PHP_URL_QUERY) || parse_url($baseUrl,PHP_URL_FRAGMENT)) { cmsAgentFail(422,'HTTPS-Domain erforderlich.'); }
        $email = $body['adminEmail'] ?? ''; $name = $body['adminName'] ?? ''; $password = $body['adminPassword'] ?? '';
        if (!is_string($email) || !filter_var($email,FILTER_VALIDATE_EMAIL) || !is_string($name) || trim($name)==='' || !is_string($password) || strlen($password)<12 || strlen($password)>72) { cmsAgentFail(422,'Administratorkonto prüfen.'); }
        $database = $body['database'] ?? []; $engine = $database['engine'] ?? 'sqlite';
        if (!in_array($engine,['sqlite','mysql'],true) || !extension_loaded('pdo_'.$engine)) { cmsAgentFail(422,'Datenbanktreiber fehlt.'); }
        if (!is_file($root.'/config/local.php')) {
            if ($engine==='mysql' && (!preg_match('/^[a-zA-Z0-9_.-]+$/D',$database['host'] ?? '') || !preg_match('/^[a-zA-Z0-9_-]+$/D',$database['name'] ?? '') || empty($database['user']))) { cmsAgentFail(422,'Datenbank-Zugang prüfen.'); }
            $dsn = $engine==='sqlite' ? "'sqlite:'.dirname(__DIR__).'/var/cms.sqlite'" : var_export('mysql:host='.$database['host'].';dbname='.$database['name'].';charset=utf8mb4',true);
            $config = "<?php\nreturn [\n'project'=>'base','dsn'=>".$dsn.",\n'db_user'=>".var_export($database['user'] ?? null,true).",'db_password'=>".var_export($database['password'] ?? null,true).",\n'storage'=>dirname(__DIR__).'/var','base_url'=>".var_export(rtrim($baseUrl,'/'),true).",'environment'=>'production'\n];\n";
            cmsAgentAtomic($root.'/config/local.php',$config);
        }
        define('LORZCMS_ROOT',$root); define('LORZCMS_CORE',$root.'/.lorzcms/releases/'.$version);
        require LORZCMS_CORE.'/runtime/bootstrap.php';
        [$configuration,$project,$store,$schema,$access,$content] = cms_boot();
        $store->install();
        $marker = $store->query("SELECT payload FROM site_state WHERE id='siteops:installation'")->fetchColumn();
        if ($marker && json_decode($marker,true,32,JSON_THROW_ON_ERROR)['jobId'] !== $job) { cmsAgentFail(409,'Datenbank gehört zu einem anderen Auftrag.'); }
        if (!$marker) {
            $store->transaction(static function() use($store,$access,$content,$body,$email,$name,$password,$job,$agent): void {
                if ((int)$store->query('SELECT COUNT(*) FROM users')->fetchColumn() !== 0 || (int)$store->query('SELECT COUNT(*) FROM contents')->fetchColumn() !== 0) { cmsAgentFail(409,'Diese Datenbank enthält bereits CMS-Daten.'); }
                $id = $access->create($email,$name,$password,'admin'); $actor=$access->user($id);
                $settings = $content->site->value('settings'); $settings['name']=$body['siteName'] ?? 'Meine Website';
                $content->site->save('settings',0,$settings,$actor);
                $content->create('page','Willkommen','/',['body'=>'<p>Deine Website ist eingerichtet. Bearbeite die Startseite in der Verwaltung.</p>'],[],'published',$actor);
                $store->query('INSERT INTO site_state VALUES (?,?,?,?)',['siteops:installation',SiteCms\Store::json(['jobId'=>$job,'instanceId'=>$agent['instance_id']]),1,gmdate('c')]);
            });
        }
        $backup = null;
    } else {
        if (!$state || !is_file($root.'/config/local.php')) { cmsAgentFail(409,'CMS noch nicht eingerichtet.'); }
        if (($body['expectedVersion'] ?? null) !== $state['version']) { cmsAgentFail(409,'Installierter Stand hat sich geändert.'); }
        if (is_file($root.'/.lorzcms/maintenance')) { cmsAgentFail(409,'Wartungsmodus muss zuerst geprüft werden.'); }
        define('LORZCMS_ROOT',$root); define('LORZCMS_CORE',$root.'/.lorzcms/releases/'.$version);
        require LORZCMS_CORE.'/runtime/bootstrap.php';
        [$configuration,$project,$store] = cms_boot();
        $backup = cmsAgentBackup($root,$job,$store->db);
        cmsAgentAtomic($root.'/.lorzcms/maintenance',$job);
        // Schema 1 only adds missing tables; it never drops or rewrites data.
        $store->install();
    }
    $next = ['version'=>$version,'digest'=>$digest,'schemaVersion'=>$manifest['schemaVersion'],'activatedAt'=>gmdate('c'),'jobId'=>$job];
    cmsAgentAtomic($statePath,json_encode($next,JSON_THROW_ON_ERROR));
    $result = ['ok'=>true,'instanceId'=>$agent['instance_id'],'version'=>$version,'previousVersion'=>$state['version'] ?? null,'backupId'=>$backup];
    cmsAgentAtomic($journal,json_encode(['requestHash'=>$requestHash,'result'=>$result],JSON_THROW_ON_ERROR));
    unlink($progressPath);
    if (is_file($root.'/.lorzcms/maintenance')) { unlink($root.'/.lorzcms/maintenance'); }
    echo json_encode($result,JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    if (isset($job) && is_file($root.'/.lorzcms/maintenance') && file_get_contents($root.'/.lorzcms/maintenance') === $job) { unlink($root.'/.lorzcms/maintenance'); }
    // Do not return a PDO DSN, token, SQL, password or request body.
    http_response_code($error instanceof CmsAgentError ? $error->getCode() : 500);
    echo json_encode(['error'=>$error instanceof CmsAgentError ? $error->getMessage() : 'Der CMS-Auftrag konnte nicht abgeschlossen werden.'],JSON_THROW_ON_ERROR);
} finally {
    if (is_resource($lock)) { flock($lock,LOCK_UN); fclose($lock); }
}
