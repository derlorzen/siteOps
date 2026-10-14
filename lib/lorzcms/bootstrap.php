<?php
declare(strict_types=1);
if (!defined('LORZCMS_ROOT')) { define('LORZCMS_ROOT', __DIR__); }
$state = json_decode((string)file_get_contents(LORZCMS_ROOT.'/.lorzcms/active.json'), true, 32, JSON_THROW_ON_ERROR);
if (!preg_match('/^(?:\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?|legacy-[a-f0-9]{12})$/D', $state['version'] ?? '')) { throw new RuntimeException('Ungültiger Core-Stand.'); }
define('LORZCMS_CORE', LORZCMS_ROOT.'/.lorzcms/releases/'.$state['version']);
require LORZCMS_CORE.'/runtime/bootstrap.php';
