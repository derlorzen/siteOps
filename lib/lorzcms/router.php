<?php
declare(strict_types=1);
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/siteops.php') { require __DIR__.'/siteops.php'; }
else { require __DIR__.'/index.php'; }
