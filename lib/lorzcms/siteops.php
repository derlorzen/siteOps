<?php
declare(strict_types=1);
$agent = dirname(__DIR__).'/.lorzcms/agent.php';
if (!is_file($agent)) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"error":"Anschluss nicht eingerichtet."}';
    return;
}
require $agent;
