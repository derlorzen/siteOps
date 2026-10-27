<?php
declare(strict_types=1);
$root = dirname(__DIR__);
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (is_file($root.'/.lorzcms/maintenance')) {
    http_response_code(503); header('Retry-After: 30'); echo 'Die Website wird gerade aktualisiert.'; return;
}
if (!is_file($root.'/.lorzcms/active.json')) {
    http_response_code(503); echo 'Die Einrichtung wird vorbereitet.'; return;
}
require $root.'/bootstrap.php';
// Imported WordPress media retain their original URLs. Only known static
// extensions under this directory are served; project/config/PHP stay private.
if (str_starts_with($path, '/wp-content/uploads/')) {
    $decoded=rawurldecode($path);
    if (!preg_match('~^/wp-content/uploads/[A-Za-z0-9_./-]+\.(png|jpe?g|webp|gif|svg|pdf)$~D',$decoded,$match) || str_contains($decoded,'..')) { http_response_code(404); return; }
    $file=realpath($root.'/public'.$decoded);
    $directory=realpath($root.'/public/wp-content/uploads');
    if (!$file || !$directory || !is_file($file) || !str_starts_with(str_replace('\\','/',$file),str_replace('\\','/',$directory).'/')) { http_response_code(404); return; }
    $mime=['png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg','webp'=>'image/webp','gif'=>'image/gif','svg'=>'image/svg+xml','pdf'=>'application/pdf'];
    header('Content-Type: '.$mime[$match[1]]);header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'");
    header('Content-Length: '.filesize($file));
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET')!=='HEAD') { SiteCms\Stream::file($file); }
    return;
}
if (str_starts_with($path, '/assets/')) {
    if (!preg_match('~^/assets/([a-zA-Z0-9._-]+\.(css|js|svg)|fonts/[a-zA-Z0-9._-]+\.(ttf|woff2?|txt))$~D', $path, $m)) { http_response_code(404); return; }
    $asset = substr($path, 8);
    $file = LORZCMS_CORE.'/assets/'.$asset;
    if (!is_file($file)) { $file = $root.'/public/assets/'.$asset; }
    if ($asset !== 'site-theme.css') {
        if (!is_file($file)) { http_response_code(404); return; }
        $mime = ['css'=>'text/css', 'js'=>'text/javascript', 'svg'=>'image/svg+xml', 'woff2'=>'font/woff2', 'woff'=>'font/woff', 'ttf'=>'font/ttf', 'txt'=>'text/plain'];
        header('Content-Type: '.$mime[pathinfo($file, PATHINFO_EXTENSION)]);
        header('Cache-Control: no-cache'); header('X-Content-Type-Options: nosniff');
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') { readfile($file); } return;
    }
}
require LORZCMS_CORE.'/runtime/index.php';
